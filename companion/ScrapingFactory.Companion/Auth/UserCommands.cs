using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// Out-of-band user administration, run on the machine that runs the companion against the same storage and settings:
//
//   ScrapingFactory.Companion user add <name>      create a user, print the key (once)
//   ScrapingFactory.Companion user list
//   ScrapingFactory.Companion user rotate <name>   issue a new key (the old one stops working)
//   ScrapingFactory.Companion user remove <name>   delete the user (their data stays, unreachable)
//   ScrapingFactory.Companion user adopt <name>    give the user all data saved before authentication was switched on
//   ScrapingFactory.Companion user set-password <name>   set or reset a password (terminal or one stdin line); signs the user out everywhere
//   ScrapingFactory.Companion user disable <name>  the user's key and logins stop working
//   ScrapingFactory.Companion user enable <name>   undo that
//   ScrapingFactory.Companion user set-email <name> <email> [--verified]   no mailed code needed for an operator
//   ScrapingFactory.Companion user verify <name>   mark the user's email address as verified
public static class UserCommands
{
    // One line from the given reader (tests, a pipe), otherwise typed on the
    // terminal without echo.
    private static string? ReadPassword(TextReader? input, TextWriter output, string prompt)
    {
        if (input is not null)
            return input.ReadLine();
        if (Console.IsInputRedirected)
            return Console.In.ReadLine();
        output.Write(prompt);
        var typed = new System.Text.StringBuilder();
        while (Console.ReadKey(intercept: true) is var key && key.Key != ConsoleKey.Enter)
        {
            if (key.Key == ConsoleKey.Backspace && typed.Length > 0) typed.Length--;
            else if (!char.IsControl(key.KeyChar)) typed.Append(key.KeyChar);
        }
        output.WriteLine();
        return typed.ToString();
    }

    public static bool IsUserCommand(string[] args) => args.Length > 0 && args[0].Equals("user", StringComparison.OrdinalIgnoreCase);

    public static int Run(string[] args, IConfiguration configuration, TextWriter? output = null, TextWriter? error = null, TextReader? input = null)
    {
        output ??= Console.Out;
        error ??= Console.Error;
        var positional = args.Skip(1).Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToList();
        var command = positional.FirstOrDefault()?.ToLowerInvariant();
        var name = positional.Skip(1).FirstOrDefault();

        if (command is null or "help" || command is not ("add" or "list" or "rotate" or "remove" or "adopt" or "set-password" or "disable" or "enable" or "set-email" or "verify"))
        {
            (command is null or "help" ? output : error).WriteLine(
                "Usage: ScrapingFactory.Companion user <add|list|rotate|remove|adopt|set-password|disable|enable|set-email|verify> [name]\n" +
                "  add <name>     create a user and print their access key (shown only once)\n" +
                "  list           list the users\n" +
                "  rotate <name>  issue a new access key (the old one stops working)\n" +
                "  remove <name>  delete a user (their data stays in the database, unreachable)\n" +
                "  adopt <name>   give a user all data saved before authentication was switched on\n" +
                "  set-password <name>  set or reset a password (asked on the terminal, or one line on stdin); signs the user out everywhere\n" +
                "  disable <name> / enable <name>  switch a user's access off / on again\n" +
                "  set-email <name> <email> [--verified]  set a user's email address (unverified unless --verified)\n" +
                "  verify <name>  mark a user's email address as verified");
            return command is null or "help" ? 0 : 2;
        }
        if (command != "list" && string.IsNullOrWhiteSpace(name))
        {
            error.WriteLine($"'user {command}' needs a user name.");
            return 2;
        }

        try
        {
            var users = StorageOptions.CreateUserStore(configuration);
            switch (command)
            {
                case "add":
                {
                    if (!UserNames.IsValid(name))
                    {
                        error.WriteLine($"Invalid user name '{name}': {UserNames.Rules}.");
                        return 2;
                    }
                    var (user, key) = users.Create(name!);
                    output.WriteLine($"Created user '{user.Name}'. Access key (shown only once — enter it in the extension's Settings):");
                    output.WriteLine();
                    output.WriteLine($"  {key}");
                    output.WriteLine();
                    if (!AuthOptions.IsEnabled(configuration))
                        output.WriteLine($"Note: authentication is not switched on yet ({AuthOptions.EnabledKey} = true, or the installer's --enable-auth).");
                    return 0;
                }
                case "list":
                {
                    var all = users.List();
                    if (all.Count == 0) output.WriteLine("No users yet — create one with: user add <name>");
                    foreach (var user in all)
                        output.WriteLine($"{user.Name}\t(created {user.CreatedAt}){(user.HasPassword ? "  [password]" : "")}{(user.Disabled ? "  [disabled]" : "")}" +
                            (user.Email is null ? "" : $"  {user.Email}{(user.EmailVerified ? " [verified]" : " [unverified]")}"));
                    return 0;
                }
                case "rotate":
                {
                    var key = users.RotateKey(name!);
                    if (key is null) { error.WriteLine($"No user named '{name}'."); return 1; }
                    output.WriteLine($"New access key for '{name}' (shown only once; the old key no longer works):");
                    output.WriteLine();
                    output.WriteLine($"  {key}");
                    return 0;
                }
                case "remove":
                {
                    if (!users.Remove(name!)) { error.WriteLine($"No user named '{name}'."); return 1; }
                    output.WriteLine($"Removed user '{name}'. Their saved data stays in the database but can no longer be reached.");
                    return 0;
                }
                case "set-password":
                {
                    var user = users.FindByName(name!);
                    if (user is null) { error.WriteLine($"No user named '{name}'."); return 1; }
                    var password = ReadPassword(input, output, $"New password for '{user.Name}': ");
                    if (PasswordHasher.CheckPolicy(password, user.Name) is { } problem) { error.WriteLine(problem); return 2; }
                    users.SetPassword(user.Name, PasswordHasher.Hash(password!));
                    var signedOut = users.RevokeTokens(user.Id);
                    output.WriteLine($"Password for '{user.Name}' set; {signedOut} signed-in device(s) were signed out.");
                    return 0;
                }
                case "set-email":
                {
                    var typed = positional.Skip(2).FirstOrDefault();
                    var email = EmailOptions.Normalize(typed);
                    if (email is null) { error.WriteLine($"'{typed}' is not a valid email address."); return 2; }
                    var user = users.FindByName(name!);
                    if (user is null) { error.WriteLine($"No user named '{name}'."); return 1; }
                    var verified = args.Contains("--verified", StringComparer.Ordinal);
                    try { users.SetEmail(user.Id, email, verified); }
                    catch (EmailInUseException) { error.WriteLine($"The address '{email}' belongs to another user."); return 1; }
                    output.WriteLine($"Email address of '{user.Name}' set to {email} ({(verified ? "verified" : "not verified yet")}).");
                    return 0;
                }
                case "verify":
                {
                    var user = users.FindByName(name!);
                    if (user is null) { error.WriteLine($"No user named '{name}'."); return 1; }
                    if (user.Email is null) { error.WriteLine($"'{user.Name}' has no email address - set one with: user set-email {user.Name} <email>"); return 1; }
                    users.SetEmailVerified(user.Id, true);
                    output.WriteLine($"The email address of '{user.Name}' ({user.Email}) is now verified.");
                    return 0;
                }
                case "disable":
                case "enable":
                {
                    if (!users.SetDisabled(name!, command == "disable")) { error.WriteLine($"No user named '{name}'."); return 1; }
                    output.WriteLine(command == "disable"
                        ? $"User '{name}' is disabled: their key and logins no longer work (their data stays)."
                        : $"User '{name}' is enabled again.");
                    return 0;
                }
                default: // adopt
                {
                    var user = users.FindByName(name!);
                    if (user is null) { error.WriteLine($"No user named '{name}'."); return 1; }
                    var configs = StorageOptions.CreateSavedConfigStore(configuration).ClaimUnowned(user.Id);
                    var blueprints = StorageOptions.CreateOutputBlueprintStore(configuration).ClaimUnowned(user.Id);
                    var presets = StorageOptions.CreateTransformPresetStore(configuration).ClaimUnowned(user.Id);
                    output.WriteLine($"'{user.Name}' now owns {configs} saved configuration(s), {blueprints} output blueprint(s) and {presets} transform preset(s) that were saved without authentication.");
                    return 0;
                }
            }
        }
        catch (InvalidOperationException exception)
        {
            error.WriteLine(exception.Message);
            return 1;
        }
        catch (MySqlConnector.MySqlException exception)
        {
            error.WriteLine($"The storage database is not available: {exception.Message}");
            return 1;
        }
    }
}

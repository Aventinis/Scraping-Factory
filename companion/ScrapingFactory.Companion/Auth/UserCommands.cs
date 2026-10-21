using Microsoft.Extensions.Configuration;
using ScrapingFactory.Companion.Storage;

namespace ScrapingFactory.Companion.Auth;

// Issue #278: the out-of-band user administration — run on the machine that
// runs the companion, against the same storage backend/settings the companion
// itself uses (so an installed companion's settings file, or the MySQL server
// it points at, is honored):
//
//   ScrapingFactory.Companion user add <name>      create a user, print the key (once)
//   ScrapingFactory.Companion user list
//   ScrapingFactory.Companion user rotate <name>   issue a new key (the old one stops working)
//   ScrapingFactory.Companion user remove <name>   delete the user (their data stays, unreachable)
//   ScrapingFactory.Companion user adopt <name>    give the user all data saved before
//                                                  authentication was switched on
public static class UserCommands
{
    public static bool IsUserCommand(string[] args) => args.Length > 0 && args[0].Equals("user", StringComparison.OrdinalIgnoreCase);

    public static int Run(string[] args, IConfiguration configuration, TextWriter? output = null, TextWriter? error = null)
    {
        output ??= Console.Out;
        error ??= Console.Error;
        var positional = args.Skip(1).Where(a => !a.StartsWith("--", StringComparison.Ordinal)).ToList();
        var command = positional.FirstOrDefault()?.ToLowerInvariant();
        var name = positional.Skip(1).FirstOrDefault();

        if (command is null or "help" || command is not ("add" or "list" or "rotate" or "remove" or "adopt"))
        {
            (command is null or "help" ? output : error).WriteLine(
                "Usage: ScrapingFactory.Companion user <add|list|rotate|remove|adopt> [name]\n" +
                "  add <name>     create a user and print their access key (shown only once)\n" +
                "  list           list the users\n" +
                "  rotate <name>  issue a new access key (the old one stops working)\n" +
                "  remove <name>  delete a user (their data stays in the database, unreachable)\n" +
                "  adopt <name>   give a user all data saved before authentication was switched on");
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
                    foreach (var user in all) output.WriteLine($"{user.Name}\t(created {user.CreatedAt})");
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

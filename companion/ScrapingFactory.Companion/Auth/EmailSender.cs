using MailKit.Net.Smtp;
using MailKit.Security;
using MimeKit;

namespace ScrapingFactory.Companion.Auth;

public sealed record EmailMessage(string To, string Subject, string Body);

// Issue #353: how a message leaves the companion. One implementation speaks
// SMTP (MailKit); tests register a fake.
public interface IEmailSender
{
    Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default);
}

// Registered when no SMTP server is configured: every email feature is off then
// and nothing should ever call it.
public sealed class NoEmailSender : IEmailSender
{
    public Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default) =>
        throw new InvalidOperationException("No SMTP server is configured (Companion:Email:Smtp:Host).");
}

public sealed class SmtpEmailSender(SmtpSettings settings) : IEmailSender
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(20);

    public async Task SendAsync(EmailMessage message, CancellationToken cancellationToken = default)
    {
        var mime = new MimeMessage();
        mime.From.Add(MailboxAddress.Parse(settings.From));
        mime.To.Add(MailboxAddress.Parse(message.To));
        mime.Subject = message.Subject;
        mime.Body = new TextPart("plain") { Text = message.Body };

        using var client = new SmtpClient { Timeout = (int)Timeout.TotalMilliseconds };
        var options = settings.Security switch
        {
            SmtpSecurity.SslOnConnect => SecureSocketOptions.SslOnConnect,
            SmtpSecurity.None => SecureSocketOptions.None,
            _ => SecureSocketOptions.StartTls,
        };
        await client.ConnectAsync(settings.Host, settings.Port, options, cancellationToken);
        if (settings.Username is not null)
            await client.AuthenticateAsync(settings.Username, settings.Password ?? "", cancellationToken);
        await client.SendAsync(mime, cancellationToken);
        await client.DisconnectAsync(quit: true, cancellationToken);
    }
}

public static class EmailMessages
{
    public static EmailMessage Verification(string to, string userName, string code) => new(
        to,
        "Scraping Factory: confirm your email address",
        $"Hello {userName},\n\n" +
        $"your confirmation code is: {code}\n\n" +
        "Enter it in the extension under Settings > Account. The code is valid for 24 hours.\n\n" +
        "If you did not create an account or add this address, you can ignore this message.\n");

    public static EmailMessage PasswordReset(string to, string userName, string code) => new(
        to,
        "Scraping Factory: password reset code",
        $"Hello,\n\n" +
        $"someone (hopefully you) asked to reset the password of the account '{userName}'.\n\n" +
        $"Your code is: {code}\n\n" +
        "Enter it in the extension together with a new password. The code is valid for 30 minutes.\n\n" +
        "If you did not ask for this, ignore this message - your password has not been changed.\n");
}

using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Issue #87: builds the single Scriban context object every one of the six
// templates renders `change_detection.*` from — every *_env_var_literal
// field is either a Python string literal (the env var *name*, never a
// value — see ChangeDetectionConfig's own doc comment) or the literal
// "None" when that particular field isn't configured (either because
// Notify picked the other method, or because it's one of Email's optional
// fields). Always emitting all seven possible fields, regardless of which
// method is active, keeps every template's own Scriban logic uniform
// instead of branching on which shape of object it got.
internal static class PythonChangeDetectionLiteral
{
    public static object BuildContext(ChangeDetectionConfig? changeDetection)
    {
        if (changeDetection is null)
        {
            return new
            {
                enabled = false,
                // Plain "Email"/"Webhook" (not Python-literal-quoted) — used
                // for Scriban {{ if }} branching on which imports/helper to
                // render, kept separate from notify_literal below (the
                // quoted form actually emitted as Python source), so the
                // template layer never has to compare against a
                // string-with-quotes.
                notify_method = (string?)null,
                notify_literal = "None",
                smtp_host_env_var_literal = "None",
                smtp_port_env_var_literal = "None",
                smtp_username_env_var_literal = "None",
                smtp_password_env_var_literal = "None",
                from_env_var_literal = "None",
                to_env_var_literal = "None",
                webhook_url_env_var_literal = "None",
            };
        }

        var email = changeDetection.Email;
        var webhook = changeDetection.Webhook;
        return new
        {
            enabled = true,
            notify_method = changeDetection.Notify,
            notify_literal = PythonLiteral.Str(changeDetection.Notify),
            smtp_host_env_var_literal = email is null ? "None" : PythonLiteral.Str(email.SmtpHostEnvVar),
            smtp_port_env_var_literal = email?.SmtpPortEnvVar is { } port ? PythonLiteral.Str(port) : "None",
            smtp_username_env_var_literal = email?.SmtpUsernameEnvVar is { } user ? PythonLiteral.Str(user) : "None",
            smtp_password_env_var_literal = email?.SmtpPasswordEnvVar is { } pass_ ? PythonLiteral.Str(pass_) : "None",
            from_env_var_literal = email is null ? "None" : PythonLiteral.Str(email.FromEnvVar),
            to_env_var_literal = email is null ? "None" : PythonLiteral.Str(email.ToEnvVar),
            webhook_url_env_var_literal = webhook is null ? "None" : PythonLiteral.Str(webhook.UrlEnvVar),
        };
    }
}

using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Compiler.Backends.Python;

// Builds the `change_detection.*` Scriban context. Every *_env_var_literal is a Python string literal (an env var
// *name*) or "None"; all seven are always emitted so the templates need no branching on the object's shape.
internal static class PythonChangeDetectionLiteral
{
    public static object BuildContext(ChangeDetectionConfig? changeDetection)
    {
        if (changeDetection is null)
        {
            return new
            {
                enabled = false,
                // Plain "Email"/"Webhook" for Scriban branching, apart from notify_literal (the quoted Python form).
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

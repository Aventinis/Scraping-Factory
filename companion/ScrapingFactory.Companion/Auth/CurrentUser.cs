namespace ScrapingFactory.Companion.Auth;

// Issue #278: who a request belongs to. Without authentication every request is
// the anonymous owner 0 (today's single-tenant behavior); with it, the user the
// access key resolved to — set by the authentication middleware in Program.cs
// and bound into endpoint handlers as a plain parameter.
public sealed record CurrentUser(long Id, string Name)
{
    public static readonly CurrentUser Anonymous = new(0, "");

    private const string ItemKey = "sf.current-user";

    public static void Set(HttpContext context, CurrentUser user) => context.Items[ItemKey] = user;

    // Minimal-API custom binding: `CurrentUser user` in a handler's parameter list.
    public static ValueTask<CurrentUser> BindAsync(HttpContext context) =>
        ValueTask.FromResult(context.Items.TryGetValue(ItemKey, out var user) && user is CurrentUser current ? current : Anonymous);
}

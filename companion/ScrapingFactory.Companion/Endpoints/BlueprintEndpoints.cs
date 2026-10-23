using ScrapingFactory.Companion.Auth;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// Output Blueprints: named, reusable target schemas, independent of any one configuration or site. A configuration's
// mapping never round-trips through here at generate time; the extension resolves the blueprint once and sends the
// resolved mapping with /generate.
public static class BlueprintEndpoints
{
    public static void MapBlueprintEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/blueprints", (SaveBlueprintRequest? request, IOutputBlueprintStore store, CurrentUser user) =>
        {
            var (name, schemaKind, fieldNames, tree, error) = ValidateRequest(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            var saved = store.Save(name!, schemaKind, fieldNames, tree, ownerId: user.Id);
            return Results.Created($"/blueprints/{saved.Id}", saved);
        });

        app.MapGet("/blueprints", (IOutputBlueprintStore store, CurrentUser user) => Results.Ok(store.ListAll(ownerId: user.Id)));

        app.MapGet("/blueprints/{id:long}", (long id, IOutputBlueprintStore store, CurrentUser user) =>
        {
            var record = store.Get(id, ownerId: user.Id);
            return record is null ? Results.NotFound(new { error = "Output blueprint not found." }) : Results.Ok(record);
        });

        app.MapPut("/blueprints/{id:long}", (long id, SaveBlueprintRequest? request, IOutputBlueprintStore store, CurrentUser user) =>
        {
            if (store.Get(id, ownerId: user.Id) is null)
                return Results.NotFound(new { error = "Output blueprint not found." });

            var (name, schemaKind, fieldNames, tree, error) = ValidateRequest(request);
            if (error is not null)
                return Results.BadRequest(new { error });

            store.Update(id, name!, schemaKind, fieldNames, tree, ownerId: user.Id);
            return Results.Ok(new { id, name, schemaKind, fieldNames, tree });
        });

        app.MapDelete("/blueprints/{id:long}", (long id, IOutputBlueprintStore store, CurrentUser user) =>
            store.Delete(id, ownerId: user.Id) ? Results.NoContent() : Results.NotFound(new { error = "Output blueprint not found." }));
    }

    private static List<string>? NormalizeFieldNames(List<string>? fieldNames) =>
        fieldNames?.Select(name => name.Trim()).Where(name => name.Length > 0).ToList();

    // Shared by POST and PUT. A missing SchemaKind means "Flat", so a request from an extension that predates tree
    // schemas keeps working; "Flat"/"Tree" match case-insensitively and are PascalCase like every other wire enum. A
    // Tree request's FieldNames is ignored (and a Flat request's Tree).
    private static (string? Name, string SchemaKind, List<string>? FieldNames, List<OutputBlueprintTreeSchemaNode>? Tree, string? Error)
        ValidateRequest(SaveBlueprintRequest? request)
    {
        var name = request?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return (null, "", null, null, "Name is required.");

        var requestedKind = request?.SchemaKind?.Trim();
        var schemaKind = string.IsNullOrWhiteSpace(requestedKind) ? "Flat"
            : string.Equals(requestedKind, "Flat", StringComparison.OrdinalIgnoreCase) ? "Flat"
            : string.Equals(requestedKind, "Tree", StringComparison.OrdinalIgnoreCase) ? "Tree"
            : null;
        if (schemaKind is null)
            return (null, "", null, null, "SchemaKind must be 'Flat' or 'Tree'.");

        if (schemaKind == "Tree")
        {
            var treeError = OutputBlueprintTreeSchemaValidator.Validate(request?.Tree ?? []);
            return treeError is not null
                ? (null, "", null, null, treeError)
                : (name, schemaKind, null, request!.Tree, null);
        }

        var fieldNames = NormalizeFieldNames(request?.FieldNames);
        if (fieldNames is not { Count: > 0 })
            return (null, "", null, null, "At least one field name is required.");
        if (fieldNames.Distinct().Count() != fieldNames.Count)
            return (null, "", null, null, "Field names must be unique.");

        return (name, schemaKind, fieldNames, null, null);
    }
}

public sealed class SaveBlueprintRequest
{
    public string? Name { get; set; }
    public List<string>? FieldNames { get; set; }

    // "Flat" (the default) or "Tree".
    public string? SchemaKind { get; set; }
    public List<OutputBlueprintTreeSchemaNode>? Tree { get; set; }
}

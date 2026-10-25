using ScrapingFactory.Companion.Auth;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// Reusable, named transform chains.
public static class TransformPresetEndpoints
{
    public static void MapTransformPresetEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/transform-presets", (SaveTransformPresetRequest? request, ITransformPresetStore store, CurrentUser user) =>
        {
            var name = request?.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new { error = "Name is required." });
            var chainError = ValidateChain(request!.Transforms);
            if (chainError is not null)
                return Results.BadRequest(new { error = chainError });
            if (store.NameTaken(name, ownerId: user.Id))
                return Results.Conflict(new { error = $"A preset named '{name}' already exists." });

            var saved = store.Save(name, request.Transforms!, ownerId: user.Id);
            return Results.Created($"/transform-presets/{saved.Id}", saved);
        });

        app.MapGet("/transform-presets", (ITransformPresetStore store, CurrentUser user) => Results.Ok(store.ListAll(ownerId: user.Id)));

        app.MapPut("/transform-presets/{id:long}", (long id, RenameTransformPresetRequest? request, ITransformPresetStore store, CurrentUser user) =>
        {
            if (!store.Exists(id, ownerId: user.Id))
                return Results.NotFound(new { error = "Transform preset not found." });
            var name = request?.Name?.Trim();
            if (string.IsNullOrWhiteSpace(name))
                return Results.BadRequest(new { error = "Name is required." });
            if (store.NameTaken(name, id, ownerId: user.Id))
                return Results.Conflict(new { error = $"A preset named '{name}' already exists." });

            store.Rename(id, name, ownerId: user.Id);
            return Results.Ok(new { id, name });
        });

        app.MapDelete("/transform-presets/{id:long}", (long id, ITransformPresetStore store, CurrentUser user) =>
            store.Delete(id, ownerId: user.Id) ? Results.NoContent() : Results.NotFound(new { error = "Transform preset not found." }));
    }

    // A chain gets the validation it would get on a field at /generate time (through a throwaway one-field plan), plus
    // two rules of its own: at least one step, and no combine/split steps, which reference other fields by name.
    private static string? ValidateChain(List<FieldTransform>? transforms)
    {
        const string PresetFieldName = "__transform_preset__";
        if (transforms is not { Count: > 0 })
            return "A preset needs at least one transform step.";
        if (transforms.Any(t => t is null))
            return "A preset contains an invalid transform step.";
        if (transforms.Any(t => t is CombineFieldsTransform or SplitFieldTransform))
            return "Combine/split steps reference other fields by name and can't be part of a reusable preset.";

        var plan = new ScrapingPlan
        {
            Steps =
            [
                new NavigateStep { Urls = ["https://example.com"] },
                new ExtractStep { Name = PresetFieldName, Selector = "*", Transforms = transforms },
            ],
        };
        var result = ScrapingPlanValidator.Validate(plan);
        // The validator words errors per field; the throwaway field's label is swapped for wording that fits a preset.
        return result.Success ? null : result.Error?.Replace($"field '{PresetFieldName}'", "this preset");
    }
}

public sealed class SaveTransformPresetRequest
{
    public string? Name { get; set; }
    public List<FieldTransform>? Transforms { get; set; }
}

// PUT /transform-presets/{id}: rename only.
public sealed class RenameTransformPresetRequest
{
    public string? Name { get; set; }
}

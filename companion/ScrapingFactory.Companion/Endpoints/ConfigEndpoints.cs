using System.Text.Json;
using ScrapingFactory.Companion.Auth;
using ScrapingFactory.Compiler.Backends;
using ScrapingFactory.Compiler.IR;

namespace ScrapingFactory.Companion.Endpoints;

// Saved configurations and the outputs linked to them. Purely local: nothing here leaves the user's machine. Every call is
// scoped to the signed-in user (CurrentUser.Id; 0 when authentication is off).
public static class ConfigEndpoints
{
    public static void MapConfigEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/configs", SaveConfig);

        // url is optional: without it, every host is listed (the Combined-mode picker needs that).
        app.MapGet("/configs", (string? url, ISavedConfigStore store, CurrentUser user) =>
            Results.Ok(string.IsNullOrWhiteSpace(url) ? store.ListAll(ownerId: user.Id) : store.ListByUrl(url, ownerId: user.Id)));

        app.MapGet("/configs/{id:long}", GetConfig);

        app.MapDelete("/configs/{id:long}", (long id, ISavedConfigStore store, CurrentUser user) =>
            store.Delete(id, ownerId: user.Id) ? Results.NoContent() : Results.NotFound(new { error = "Saved configuration not found." }));

        app.MapPost("/configs/{configId:long}/outputs", SaveOutput);
        app.MapGet("/configs/{configId:long}/outputs", ListOutputs);
        app.MapGet("/configs/{configId:long}/outputs/{id:long}", GetOutput);
        app.MapDelete("/configs/{configId:long}/outputs/{id:long}", DeleteOutput);
        app.MapPost("/configs/{configId:long}/outputs/{id:long}/replay-hardening", ReplayHardening);
    }

    private static IResult SaveConfig(SaveConfigRequest? request, ISavedConfigStore store, CurrentUser user)
    {
        var url = request?.Url?.Trim();
        var name = request?.Name?.Trim();
        if (string.IsNullOrWhiteSpace(url) || string.IsNullOrWhiteSpace(name) ||
            request!.Config.ValueKind != JsonValueKind.Object)
        {
            return Results.BadRequest(new { error = "Url, Name and a Config object are required." });
        }

        // The one place ConfigJson's structure is looked at: the blueprint id is derived once so "outputs sharing a
        // blueprint" is a SQL join (see SavedConfigStore). Absent or malformed means no blueprint.
        long? blueprintId = request.Config.TryGetProperty("outputBlueprint", out var blueprintProp) &&
            blueprintProp.ValueKind == JsonValueKind.Object &&
            blueprintProp.TryGetProperty("blueprintId", out var blueprintIdProp) &&
            blueprintIdProp.ValueKind == JsonValueKind.Number
            ? blueprintIdProp.GetInt64()
            : null;

        var saved = store.Save(url, name, request.Config.GetRawText(), blueprintId, ownerId: user.Id);
        return Results.Created($"/configs/{saved.Id}", saved);
    }

    private static IResult GetConfig(long id, ISavedConfigStore store, CurrentUser user)
    {
        var record = store.Get(id, ownerId: user.Id);
        if (record is null)
            return Results.NotFound(new { error = "Saved configuration not found." });

        return Results.Ok(new
        {
            record.Id,
            record.Url,
            record.Name,
            record.SavedAt,
            record.BlueprintId,
            config = JsonDocument.Parse(record.ConfigJson).RootElement,
        });
    }

    private static IResult SaveOutput(long configId, SaveOutputRequest? request, ISavedConfigStore store, CurrentUser user)
    {
        if (store.Get(configId, ownerId: user.Id) is null)
            return Results.NotFound(new { error = "Saved configuration not found." });

        var name = request?.Name?.Trim();
        var fileName = request?.FileName?.Trim();
        var content = request?.Content;
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(fileName) || string.IsNullOrEmpty(content))
            return Results.BadRequest(new { error = "Name, FileName and Content are required." });

        var saved = store.SaveOutput(configId, name, fileName, content, ownerId: user.Id);
        return Results.Created($"/configs/{configId}/outputs/{saved.Id}", saved);
    }

    private static IResult ListOutputs(long configId, ISavedConfigStore store, CurrentUser user)
    {
        if (store.Get(configId, ownerId: user.Id) is null)
            return Results.NotFound(new { error = "Saved configuration not found." });

        return Results.Ok(store.ListOutputsByConfigId(configId, ownerId: user.Id));
    }

    private static IResult GetOutput(long configId, long id, ISavedConfigStore store, CurrentUser user)
    {
        var record = store.GetOutput(id, ownerId: user.Id);
        if (record is null || record.SavedConfigId != configId)
            return Results.NotFound(new { error = "Saved output not found." });

        return Results.Ok(record);
    }

    private static IResult DeleteOutput(long configId, long id, ISavedConfigStore store, CurrentUser user)
    {
        var record = store.GetOutput(id, ownerId: user.Id);
        if (record is null || record.SavedConfigId != configId)
            return Results.NotFound(new { error = "Saved output not found." });

        return store.DeleteOutput(id, ownerId: user.Id) ? Results.NoContent() : Results.NotFound();
    }

    // Replays the checks the popup currently has configured (not necessarily the ones saved with the output) against one
    // saved output. HardeningReplayEvaluator holds the per-check logic, mirrored from the Python templates.
    private static IResult ReplayHardening(
        long configId, long id, ReplayHardeningRequest? request, ISavedConfigStore store, CurrentUser user)
    {
        var output = store.GetOutput(id, ownerId: user.Id);
        if (output is null || output.SavedConfigId != configId)
            return Results.NotFound(new { error = "Saved output not found." });

        if (request?.Checks is not { Count: > 0 })
            return Results.BadRequest(new { error = "At least one hardening check is required." });

        // Only a BaselineCheck needs a previous result; every other kind needs just this one output.
        int? previousResultCount = null;
        string? previousUnavailableReason = null;
        if (request.Checks.Any(check => check is BaselineCheck))
            (previousResultCount, previousUnavailableReason) = ResolvePreviousResultCount(configId, id, request.CompareBasis, store, user);

        var results = HardeningReplayEvaluator.Evaluate(
            request.Checks, output.FileName, output.Content, previousResultCount, previousUnavailableReason);
        return Results.Ok(new { results });
    }

    private static (int? Count, string? UnavailableReason) ResolvePreviousResultCount(
        long configId, long outputId, string? compareBasis, ISavedConfigStore store, CurrentUser user)
    {
        string? unavailableReason = null;
        SavedOutputSummary? previous;
        if (compareBasis == "blueprint")
        {
            var config = store.Get(configId, ownerId: user.Id);
            if (config?.BlueprintId is { } blueprintId)
            {
                previous = store.GetMostRecentOutputForBlueprint(blueprintId, excludeOutputId: outputId, ownerId: user.Id);
            }
            else
            {
                previous = null;
                unavailableReason = "This configuration has no Output Blueprint set — pick \"same configuration\" instead, or set a Blueprint first.";
            }
        }
        else
        {
            previous = store.GetMostRecentOutputForConfig(configId, excludeOutputId: outputId, ownerId: user.Id);
        }

        if (previous is null)
            return (null, unavailableReason ?? "No earlier saved output is available to compare against.");

        var previousRecord = store.GetOutput(previous.Id, ownerId: user.Id)!;
        return HardeningReplayEvaluator.IsReplayable(previousRecord.FileName)
            ? (HardeningReplayEvaluator.GetResultCount(previousRecord.FileName, previousRecord.Content), unavailableReason)
            : (null, "The earlier saved output is a SQLite/Excel file, which can't be read for a comparison.");
    }
}

// Config is bound as a raw JsonElement: the store keeps it opaque.
public sealed class SaveConfigRequest
{
    public string? Url { get; set; }
    public string? Name { get; set; }
    public JsonElement Config { get; set; }
}

// Content is stored and returned verbatim, like ConfigJson.
public sealed class SaveOutputRequest
{
    public string? Name { get; set; }
    public string? FileName { get; set; }
    public string? Content { get; set; }
}

// Checks is ScrapingConfig.Hardening's wire shape. CompareBasis ("config" by default, or "blueprint") only matters with a
// BaselineCheck.
public sealed class ReplayHardeningRequest
{
    public List<HardeningCheck>? Checks { get; set; }
    public string? CompareBasis { get; set; }
}

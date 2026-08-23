namespace ScrapingFactory.Compiler.IR;

public sealed class PlanValidationResult
{
    public bool Success { get; init; }

    // Set whenever Success is false.
    public string? Error { get; init; }
}

using System.Collections.Concurrent;

namespace ScrapingFactory.Companion.Auth;

// Issue #352: abuse protection for /auth/login and /auth/register — a small
// in-memory sliding window (the companion is a single process). Failed logins
// are counted per user name (lockout after a few wrong passwords) and every
// attempt per client address (so one machine can't hammer many names or
// register accounts in bulk). Counters are forgotten when the window passes
// and on restart; nothing is persisted.
public sealed class LoginThrottle
{
    private readonly ConcurrentDictionary<string, Queue<DateTimeOffset>> _events = new();
    private readonly Func<DateTimeOffset> _clock;

    public int MaxFailuresPerUser { get; init; } = 5;
    public TimeSpan UserWindow { get; init; } = TimeSpan.FromMinutes(15);
    public int MaxAttemptsPerAddress { get; init; } = 30;
    public TimeSpan AddressWindow { get; init; } = TimeSpan.FromMinutes(10);

    public LoginThrottle(Func<DateTimeOffset>? clock = null) => _clock = clock ?? (() => DateTimeOffset.UtcNow);

    // Seconds the caller has to wait, or 0 when the attempt may proceed.
    public int RetryAfterSeconds(string address, string? userName)
    {
        var wait = Wait($"ip:{address}", MaxAttemptsPerAddress, AddressWindow);
        if (!string.IsNullOrEmpty(userName))
            wait = Math.Max(wait, Wait($"user:{userName.ToLowerInvariant()}", MaxFailuresPerUser, UserWindow));
        return wait;
    }

    public void RecordAttempt(string address) => Record($"ip:{address}", AddressWindow);

    public void RecordFailure(string userName) => Record($"user:{userName.ToLowerInvariant()}", UserWindow);

    public void ClearFailures(string userName) => _events.TryRemove($"user:{userName.ToLowerInvariant()}", out _);

    private int Wait(string key, int limit, TimeSpan window)
    {
        if (!_events.TryGetValue(key, out var queue))
            return 0;
        lock (queue)
        {
            Prune(queue, window);
            if (queue.Count < limit)
                return 0;
            var seconds = (int)Math.Ceiling((queue.Peek() + window - _clock()).TotalSeconds);
            return Math.Max(1, seconds);
        }
    }

    private void Record(string key, TimeSpan window)
    {
        var queue = _events.GetOrAdd(key, _ => new Queue<DateTimeOffset>());
        lock (queue)
        {
            Prune(queue, window);
            queue.Enqueue(_clock());
        }
    }

    private void Prune(Queue<DateTimeOffset> queue, TimeSpan window)
    {
        var cutoff = _clock() - window;
        while (queue.Count > 0 && queue.Peek() < cutoff)
            queue.Dequeue();
    }
}

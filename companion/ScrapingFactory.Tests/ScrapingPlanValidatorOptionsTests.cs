using ScrapingFactory.Compiler.IR;
using Xunit;
using static ScrapingFactory.Tests.ValidatorTestPlans;

namespace ScrapingFactory.Tests;

// Run options: change detection, proxy, pagination, discovered URLs, persistent session. (ScrapingPlanValidator; the plan builders are in ValidatorTestPlans.)
public class ScrapingPlanValidatorOptionsTests
{
    // Issue #87
    [Fact]
    public void Validate_ValidEmailChangeDetection_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "SF_SMTP_HOST", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidWebhookChangeDetection_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWithUnknownNotifyMethod_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Sms" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("notify method", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithoutEmailConfig_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Email" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Email configuration", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWebhookWithoutWebhookConfig_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, ChangeDetection = new ChangeDetectionConfig { Notify = "Webhook" } };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Webhook configuration", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithInvalidHostEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "not a valid name", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Invalid environment variable name", result.Error);
        Assert.Contains("SmtpHostEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailWithInvalidOptionalPortEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig
                {
                    SmtpHostEnvVar = "SF_SMTP_HOST", SmtpPortEnvVar = "1invalid", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO",
                },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("SmtpPortEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionWebhookWithInvalidUrlEnvVarName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Webhook",
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("UrlEnvVar", result.Error);
    }

    [Fact]
    public void Validate_ChangeDetectionEmailAndWebhookBothSet_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            ChangeDetection = new ChangeDetectionConfig
            {
                Notify = "Email",
                Email = new EmailNotificationConfig { SmtpHostEnvVar = "SF_SMTP_HOST", FromEnvVar = "SF_FROM", ToEnvVar = "SF_TO" },
                Webhook = new WebhookNotificationConfig { UrlEnvVar = "SF_WEBHOOK_URL" },
            },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("must not configure both Email and Webhook", result.Error);
    }

    // Issue #88
    [Fact]
    public void Validate_ValidProxy_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "SF_PROXIES" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ProxyWithInvalidEnvironmentVariableName_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Proxy = new ProxyConfig { EnvironmentVariableName = "not a valid name" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("Invalid environment variable name", result.Error);
        Assert.Contains("Proxy.EnvironmentVariableName", result.Error);
    }

    [Fact]
    public void Validate_NoProxy_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success, result.Error);
    }

    // Issue #174
    [Fact]
    public void Validate_ValidNextLinkPagination_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_ValidPageNumberPagination_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_NoPagination_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_PaginationWithZeroOrNegativeMaxPages_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new NextLinkPagination { NextLinkSelector = "a.next", MaxPages = 0 },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("MaxPages", result.Error);
    }

    [Fact]
    public void Validate_NextLinkPaginationWithBlankSelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new NextLinkPagination { NextLinkSelector = " " },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("NextLinkSelector", result.Error);
    }

    [Fact]
    public void Validate_PageNumberPaginationWithBlankUrlTemplate_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new PageNumberPagination { UrlTemplate = " " },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("UrlTemplate", result.Error);
    }

    // Issue #405: {url} is optional for a single start page, {page} never is.
    [Theory]
    [InlineData("{url}")]
    [InlineData("https://example.com/list")]
    [InlineData("no placeholders at all")]
    public void Validate_PageNumberPaginationWithoutPageTemplate_Fails(string urlTemplate)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new PageNumberPagination { UrlTemplate = urlTemplate },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("missing placeholder", result.Error);
        Assert.Contains("{page}", result.Error);
    }

    [Theory]
    [InlineData("https://example.com/list?page={page}")]
    [InlineData("https://example.com/list/page/{page}/")]
    public void Validate_PageNumberPaginationWithoutStartUrlPlaceholder_SucceedsForASingleStartPage(string urlTemplate)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new PageNumberPagination { UrlTemplate = urlTemplate },
        };
        Assert.True(ScrapingPlanValidator.Validate(plan).Success);
    }

    [Fact]
    public void Validate_PageNumberPaginationWithoutStartUrlPlaceholder_FailsWithSeveralStartPages()
    {
        var plan = new ScrapingPlan
        {
            Steps = [new NavigateStep { Urls = ["https://example.com/a", "https://example.com/b"] }, .. ValidPlan().Steps.Where(step => step is not NavigateStep)],
            Pagination = new PageNumberPagination { UrlTemplate = "https://example.com/a?page={page}" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("{url}", result.Error);

        var withUrl = new ScrapingPlan { Steps = plan.Steps, Pagination = new PageNumberPagination { UrlTemplate = "{url}?page={page}" } };
        Assert.True(ScrapingPlanValidator.Validate(withUrl).Success);
    }

    [Fact]
    public void Validate_PageNumberPaginationWithoutStartUrlPlaceholder_FailsWithDiscoveredUrls()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            Pagination = new PageNumberPagination { UrlTemplate = "https://example.com/list?page={page}" },
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/menu", LinkSelector = "nav a" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("{url}", result.Error);
    }

    // Issue #218
    [Fact]
    public void Validate_ValidDiscoveredUrls_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/kategorien", LinkSelector = "nav.categories a" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_NoDiscoveredUrls_Succeeds()
    {
        var result = ScrapingPlanValidator.Validate(ValidPlan());
        Assert.True(result.Success, result.Error);
    }

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("ftp://example.com/kategorien")]
    public void Validate_DiscoveredUrlsWithInvalidPageUrl_Fails(string pageUrl)
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = pageUrl, LinkSelector = "a" },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("PageUrl", result.Error);
    }

    [Fact]
    public void Validate_DiscoveredUrlsWithBlankLinkSelector_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/kategorien", LinkSelector = " " },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("LinkSelector", result.Error);
    }

    [Fact]
    public void Validate_DiscoveredUrlsWithZeroOrNegativeMaxUrls_Fails()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps,
            DiscoveredUrls = new DiscoveredUrlsConfig { PageUrl = "https://example.com/kategorien", LinkSelector = "a", MaxUrls = 0 },
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("MaxUrls", result.Error);
    }

    // Issue #175
    [Fact]
    public void Validate_PersistentSessionWithBrowserEngine_Succeeds()
    {
        var plan = new ScrapingPlan
        {
            Steps = ValidPlan().Steps, Engine = ScrapingEngine.Browser, PersistentSession = true,
        };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }

    [Fact]
    public void Validate_PersistentSessionWithoutBrowserEngine_Fails()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, Engine = ScrapingEngine.Static, PersistentSession = true };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.False(result.Success);
        Assert.Contains("PersistentSession", result.Error);
        Assert.Contains("requires Engine 'Browser'", result.Error);
    }

    [Fact]
    public void Validate_PersistentSessionDisabled_Succeeds()
    {
        var plan = new ScrapingPlan { Steps = ValidPlan().Steps, PersistentSession = false };
        var result = ScrapingPlanValidator.Validate(plan);
        Assert.True(result.Success, result.Error);
    }
}

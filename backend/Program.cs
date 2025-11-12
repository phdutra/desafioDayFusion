using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon;
using Amazon.Runtime;
using Amazon.Rekognition;
using Amazon.S3;
using Amazon.Lambda;
using Amazon.Extensions.NETCore.Setup;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using System.Text;
using System.Text.Json.Serialization;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File("logs/dayfusion-.txt", rollingInterval: RollingInterval.Day)
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container
builder.Services.AddControllers()
    .AddJsonOptions(options =>
    {
        options.JsonSerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
        options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    });

// Configurar rotas em lowercase
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteOptions>(options =>
{
    options.LowercaseUrls = true;
});
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "DayFusion API", Version = "v1" });
    c.AddSecurityDefinition("Bearer", new()
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "Bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "JWT Authorization header using the Bearer scheme."
    });
    c.AddSecurityRequirement(new()
    {
        {
            new()
            {
                Reference = new()
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// Configure CORS - Melhorado para suportar WebRTC completo
// Conforme AWS_FaceLiveness_Diagnostic.md: CORS completo necessário para WebRTC
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins(
                "http://localhost:4200",
                "https://localhost:4200",
                "http://localhost:3000",
                "https://dayfusion.app",
                "https://d14vqj8spvlhxs.cloudfront.net")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials()
              .WithExposedHeaders("*") // Permitir todos os headers para CORS
              .SetPreflightMaxAge(TimeSpan.FromMinutes(10)); // Cache preflight requests
    });
});

// Configure AWS services
var awsRegionName = builder.Configuration["AWS:Region"] ?? "us-east-1";

var awsOptions = builder.Configuration.GetAWSOptions();
awsOptions.Region = RegionEndpoint.GetBySystemName(awsRegionName);

builder.Services.AddDefaultAWSOptions(awsOptions);
builder.Services.AddSingleton<IAmazonS3>(sp =>
{
    var opts = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AWSOptions>>().Value;
    var config = new AmazonS3Config
    {
        ForcePathStyle = false,
        RegionEndpoint = opts.Region
    };
    // Note: FallbackCredentialsFactory is deprecated but still functional
    // In production, use proper AWS credential management
    var creds = opts.Credentials ?? Amazon.Runtime.FallbackCredentialsFactory.GetCredentials();
    return new AmazonS3Client(creds, config);
});
builder.Services.AddAWSService<IAmazonRekognition>();
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddAWSService<IAmazonLambda>();
builder.Services.AddScoped<IDynamoDBContext, DynamoDBContext>();

// Configure application services
builder.Services.AddScoped<IS3Service, S3Service>();
builder.Services.AddScoped<IRekognitionService, RekognitionService>();
builder.Services.AddScoped<IDynamoDBService, DynamoDBService>();
builder.Services.AddScoped<IUserProfileService, UserProfileService>();
builder.Services.AddScoped<IAntiDeepfakeService, AntiDeepfakeService>();

// Configure JWT Authentication (placeholder - in production, use AWS Cognito)
var jwtSecret = builder.Configuration["JWT:Secret"] ?? builder.Configuration["JWT_SECRET"] ?? "your-secret-key-here";
var jwtIssuer = builder.Configuration["JWT:Issuer"] ?? builder.Configuration["JWT_ISSUER"];
var jwtAudience = builder.Configuration["JWT:Audience"] ?? builder.Configuration["JWT_AUDIENCE"];

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtIssuer,
            ValidAudience = jwtAudience,
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(jwtSecret))
        };
    });

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("AdminOnly", policy =>
    {
        policy.RequireAssertion(context =>
        {
            if (context.User?.Identity?.IsAuthenticated != true)
            {
                return false;
            }

            if (context.User.IsInRole("Admin") || context.User.IsInRole("admin"))
            {
                return true;
            }

            var claimTypes = new[] { "cognito:groups", "groups", "role", "roles", "custom:role" };

            foreach (var type in claimTypes)
            {
                var claims = context.User.FindAll(type);
                foreach (var claim in claims)
                {
                    var values = claim.Value.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
                    if (values.Any(value => string.Equals(value, "admin", StringComparison.OrdinalIgnoreCase)))
                    {
                        return true;
                    }
                }
            }

            return false;
        });
    });
});

var swaggerEnabled = builder.Configuration.GetValue<bool?>("Swagger:Enabled")
    ?? builder.Configuration.GetValue<bool?>("Swagger__Enabled")
    ?? false;

var httpsRedirectEnabled = builder.Configuration.GetValue<bool?>("App:HttpsRedirect")
    ?? builder.Configuration.GetValue<bool?>("App__HttpsRedirect")
    ?? builder.Environment.IsDevelopment();

var app = builder.Build();

// Configure the HTTP request pipeline
var enableSwagger = app.Environment.IsDevelopment() || (!app.Environment.IsProduction() && swaggerEnabled);
if (enableSwagger)
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "DayFusion API v1");
        c.RoutePrefix = "swagger"; // Serve Swagger UI at /swagger
    });
}

if (httpsRedirectEnabled)
{
    // HTTPS redirecionado somente quando listener 443 estiver configurado
app.UseHttpsRedirection();
}
app.UseCors("AllowFrontend");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();

// Health check endpoint
app.MapGet("/health", () => new { Status = "Healthy", Timestamp = DateTime.UtcNow })
    .WithName("HealthCheck")
    .WithTags("Health");

if (enableSwagger)
{
    // Redirect root to Swagger UI when habilitado
app.MapGet("/", context =>
{
    context.Response.Redirect("/swagger");
    return Task.CompletedTask;
});
}
else
{
    app.MapGet("/", () => Results.Json(new { Status = "DayFusion API running", Timestamp = DateTime.UtcNow }))
        .WithName("RootStatus")
        .WithTags("Health");
}

#if DEBUG
app.MapGet("/debug/endpoints", (IEnumerable<EndpointDataSource> endpointSources) =>
{
    var endpoints = endpointSources
        .SelectMany(source => source.Endpoints)
        .Select(endpoint => new
        {
            DisplayName = endpoint.DisplayName,
            RoutePattern = (endpoint as RouteEndpoint)?.RoutePattern.RawText
        });

    return Results.Json(endpoints);
}).WithTags("Debug");
#endif

app.Run();

using Amazon.DynamoDBv2;
using Amazon.DynamoDBv2.DataModel;
using Amazon;
using Amazon.Runtime;
using Amazon.Rekognition;
using Amazon.S3;
using Amazon.Extensions.NETCore.Setup;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using Serilog;
using System.Text;

var builder = WebApplication.CreateBuilder(args);

// Configure Serilog
Log.Logger = new LoggerConfiguration()
    .WriteTo.Console()
    .WriteTo.File("logs/dayfusion-.txt", rollingInterval: RollingInterval.Day)
    .CreateLogger();

builder.Host.UseSerilog();

// Add services to the container
builder.Services.AddControllers();
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

// Configure CORS
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend", policy =>
    {
        policy.WithOrigins("http://localhost:4200", "https://localhost:4200")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// Configure AWS services (force using local AWS CLI profile if available)
// Ensure S3 presigned URLs use Signature Version 4
Amazon.AWSConfigsS3.UseSignatureVersion4 = true;
var awsRegionName = builder.Configuration["AWS:Region"] ?? "us-east-1";
var awsProfileName = builder.Configuration["AWS:Profile"] ?? Environment.GetEnvironmentVariable("AWS_PROFILE") ?? "default";

var awsOptions = builder.Configuration.GetAWSOptions();
awsOptions.Region = RegionEndpoint.GetBySystemName(awsRegionName);
try
{
    // Use stored profile credentials from ~/.aws/credentials
    awsOptions.Credentials = new StoredProfileAWSCredentials(awsProfileName);
}
catch
{
    // Fallback to the SDK default chain if profile not found
}

builder.Services.AddDefaultAWSOptions(awsOptions);
builder.Services.AddSingleton<IAmazonS3>(sp =>
{
    var opts = sp.GetRequiredService<Microsoft.Extensions.Options.IOptions<AWSOptions>>().Value;
    var config = new AmazonS3Config
    {
        SignatureVersion = "4",
        ForcePathStyle = false,
        RegionEndpoint = opts.Region
    };
    var creds = opts.Credentials;
    if (creds == null)
    {
        // Fallback explícito para a default chain (env vars, shared credentials, EC2/ECS, etc.)
        try
        {
            creds = Amazon.Runtime.FallbackCredentialsFactory.GetCredentials();
        }
        catch { /* ignored */ }
    }
    if (creds == null)
    {
        // Último recurso: falhar com mensagem clara
        throw new InvalidOperationException("AWS credentials not found. Configure AWS_PROFILE, environment variables or shared credentials.");
    }
    return new AmazonS3Client(creds, config);
});
builder.Services.AddAWSService<IAmazonRekognition>();
builder.Services.AddAWSService<IAmazonDynamoDB>();
builder.Services.AddScoped<IDynamoDBContext, DynamoDBContext>();

// Configure application services
builder.Services.AddScoped<IS3Service, S3Service>();
builder.Services.AddScoped<IRekognitionService, RekognitionService>();
builder.Services.AddScoped<IDynamoDBService, DynamoDBService>();

// Configure JWT Authentication (placeholder - in production, use AWS Cognito)
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["JWT_ISSUER"],
            ValidAudience = builder.Configuration["JWT_AUDIENCE"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["JWT_SECRET"] ?? "your-secret-key-here"))
        };
    });

builder.Services.AddAuthorization();

var app = builder.Build();

// Configure the HTTP request pipeline
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c =>
    {
        c.SwaggerEndpoint("/swagger/v1/swagger.json", "DayFusion API v1");
        c.RoutePrefix = "swagger"; // Serve Swagger UI at /swagger
    });
}

// Avoid HTTPS redirection in Development to prevent swagger.json fetch issues on HTTP
if (!app.Environment.IsDevelopment())
{
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

// Redirect root to Swagger UI for convenience
app.MapGet("/", context =>
{
    context.Response.Redirect("/swagger");
    return Task.CompletedTask;
});

app.Run();

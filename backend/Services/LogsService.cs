using Amazon.CloudWatchLogs;
using Amazon.CloudWatchLogs.Model;
using IAmazonCloudWatchLogs = Amazon.CloudWatchLogs.IAmazonCloudWatchLogs;
using DayFusion.API.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DayFusion.API.Services;

public class LogsService : ILogsService
{
    private readonly IAmazonCloudWatchLogs _cloudWatchLogs;
    private readonly IConfiguration _configuration;
    private readonly ILogger<LogsService> _logger;
    private readonly string _logGroupName;

    public LogsService(
        IAmazonCloudWatchLogs cloudWatchLogs,
        IConfiguration configuration,
        ILogger<LogsService> logger)
    {
        _cloudWatchLogs = cloudWatchLogs;
        _configuration = configuration;
        _logger = logger;
        
        // Tenta obter nome do log group da configuração ou usa padrão
        // O Elastic Beanstalk cria múltiplos log groups, vamos tentar o principal primeiro
        _logGroupName = _configuration["AWS:CloudWatchLogGroup"] 
            ?? _configuration["AWS_CLOUDWATCH_LOG_GROUP"]
            ?? "/aws/elasticbeanstalk/dayfusion-api-env/var/log/web.stdout.log";
    }

    public async Task<LogsResponse> GetLogsAsync(GetLogsRequest request)
    {
        try
        {
            _logger.LogInformation("Buscando logs. LogGroup: {LogGroup}, StartTime: {StartTime}, EndTime: {EndTime}, Filter: {Filter}",
                _logGroupName, request.StartTime, request.EndTime, request.FilterPattern);

            var startTime = request.StartTime ?? DateTime.UtcNow.AddHours(-24);
            var endTime = request.EndTime ?? DateTime.UtcNow;
            var limit = Math.Min(request.Limit ?? 100, 1000); // Máximo 1000 logs

            var startTimeMs = ((DateTimeOffset)startTime).ToUnixTimeMilliseconds();
            var endTimeMs = ((DateTimeOffset)endTime).ToUnixTimeMilliseconds();

            // Lista de log groups para tentar (em ordem de prioridade)
            var logGroupsToTry = new[]
            {
                _logGroupName,
                "/aws/elasticbeanstalk/dayfusion-api-env/var/log/web.stdout.log",
                "/aws/elasticbeanstalk/dayfusion-api-env/var/log/web.stderr.log",
                "/aws/elasticbeanstalk/dayfusion-api-env/var/log/eb-engine.log",
                "/aws/elasticbeanstalk/dayfusion-api-env/var/log/eb-hooks.log"
            };

            List<LogEntry> allLogEntries = new();
            string? lastError = null;

            foreach (var logGroup in logGroupsToTry)
            {
                try
                {
                    _logger.LogInformation("Tentando buscar logs do log group: {LogGroup}", logGroup);
                    
                    var filterRequest = new FilterLogEventsRequest
                    {
                        LogGroupName = logGroup,
                        StartTime = startTimeMs,
                        EndTime = endTimeMs,
                        Limit = limit,
                        FilterPattern = string.IsNullOrWhiteSpace(request.FilterPattern) ? null : request.FilterPattern
                    };

                    var response = await _cloudWatchLogs.FilterLogEventsAsync(filterRequest);

                    var logEntries = response.Events
                        .Where(e => e.Timestamp.HasValue)
                        .Select(e => new LogEntry
                        {
                            Timestamp = DateTimeOffset.FromUnixTimeMilliseconds(e.Timestamp!.Value).DateTime,
                            Message = e.Message ?? string.Empty,
                            LogStreamName = e.LogStreamName
                        })
                        .ToList();

                    if (logEntries.Any())
                    {
                        _logger.LogInformation("✅ Logs encontrados no grupo {LogGroup}: {Count}", logGroup, logEntries.Count);
                        allLogEntries.AddRange(logEntries);
                        
                        // Se encontrou logs no primeiro grupo, usar apenas ele
                        if (logGroup == logGroupsToTry[0])
                        {
                            break;
                        }
                    }
                }
                catch (ResourceNotFoundException)
                {
                    _logger.LogDebug("Log group não encontrado: {LogGroup}", logGroup);
                    continue;
                }
                catch (Exception ex)
                {
                    lastError = ex.Message;
                    _logger.LogWarning(ex, "Erro ao buscar logs do grupo {LogGroup}: {Error}", logGroup, ex.Message);
                    continue;
                }
            }

            if (allLogEntries.Any())
            {
                // Ordenar por timestamp e limitar
                var orderedLogs = allLogEntries
                    .OrderByDescending(e => e.Timestamp)
                    .Take(limit)
                    .ToList();

                _logger.LogInformation("Total de logs encontrados: {Count}", orderedLogs.Count);

                return new LogsResponse
                {
                    Logs = orderedLogs,
                    TotalCount = orderedLogs.Count
                };
            }
            else
            {
                // Se não encontrou logs em nenhum grupo, retornar mensagem informativa
                return await GetElasticBeanstalkLogsAsync(request);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao buscar logs do CloudWatch");
            throw;
        }
    }

    private Task<LogsResponse> GetElasticBeanstalkLogsAsync(GetLogsRequest request)
    {
        // Buscar logs do arquivo local (se disponível) ou retornar vazio
        // Em produção, os logs do EB são enviados para CloudWatch automaticamente
        _logger.LogInformation("⚠️ Nenhum log encontrado no CloudWatch. Verificando configuração...");
        
        var message = "⚠️ Log groups não encontrados no CloudWatch.\n\n" +
                     "Para configurar:\n" +
                     "1. Execute: ./scripts/setup-cloudwatch-logs.sh\n" +
                     "2. Ou configure manualmente no console AWS:\n" +
                     "   - Elastic Beanstalk → dayfusion-api-env → Configuration\n" +
                     "   - Software → CloudWatch Logs → Habilitar\n" +
                     "3. Log groups esperados:\n" +
                     "   - /aws/elasticbeanstalk/dayfusion-api-env/var/log/web.stdout.log\n" +
                     "   - /aws/elasticbeanstalk/dayfusion-api-env/var/log/web.stderr.log\n" +
                     "   - /aws/elasticbeanstalk/dayfusion-api-env/var/log/eb-engine.log";
        
        return Task.FromResult(new LogsResponse
        {
            Logs = new List<LogEntry>(),
            TotalCount = 0,
            Message = message
        });
    }
}


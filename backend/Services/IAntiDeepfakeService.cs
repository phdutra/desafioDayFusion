using DayFusion.API.Models;

namespace DayFusion.API.Services;

/// <summary>
/// Serviço para análise anti-deepfake via Lambda
/// </summary>
public interface IAntiDeepfakeService
{
    /// <summary>
    /// Analisa vídeo para detectar deepfakes e manipulações
    /// </summary>
    /// <param name="videoKey">Chave S3 do vídeo</param>
    /// <returns>Resultado da análise com score e indicadores</returns>
    Task<AntiDeepfakeResult> AnalyzeVideoAsync(string videoKey);
}


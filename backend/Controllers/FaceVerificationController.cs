using DayFusion.API.Models;
using DayFusion.API.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace DayFusion.API.Controllers;

[ApiController]
[Route("api/face")]
[AllowAnonymous]
public class FaceVerificationController : ControllerBase
{
    private readonly IFaceMatchService _faceMatchService;
    private readonly IRekognitionService _rekognitionService;
    private readonly ILogger<FaceVerificationController> _logger;

    public FaceVerificationController(
        IFaceMatchService faceMatchService,
        IRekognitionService rekognitionService,
        ILogger<FaceVerificationController> logger)
    {
        _faceMatchService = faceMatchService;
        _rekognitionService = rekognitionService;
        _logger = logger;
    }

    [HttpPost("match-from-liveness")]
    public async Task<ActionResult<MatchFromLivenessResponse>> MatchFromLiveness(
        [FromBody] MatchFromLivenessRequest request)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(request.SessionId))
                return BadRequest(new { message = "SessionId é obrigatório." });

            if (string.IsNullOrWhiteSpace(request.DocumentImageS3Path))
                return BadRequest(new { message = "DocumentImageS3Path é obrigatório." });

            if (request.AuditImages == null || request.AuditImages.Count == 0)
                return BadRequest(new { message = "AuditImages é obrigatório e deve conter pelo menos uma imagem." });

            _logger.LogInformation(
                "Match from liveness requested. SessionId: {SessionId}, DocumentPath: {Path}, AuditImages: {Count}",
                request.SessionId, request.DocumentImageS3Path, request.AuditImages.Count);

            // Obter livenessScore real via GetFaceLivenessSessionResults
            double livenessScore = 0;
            try
            {
                var livenessRequest = new GetLivenessResultRequest
                {
                    SessionId = request.SessionId
                };
                var livenessResult = await _rekognitionService.GetFaceLivenessSessionResultsAsync(livenessRequest);
                livenessScore = (livenessResult?.Confidence ?? 0) * 100;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Erro ao obter livenessScore para sessionId {SessionId}, usando 0", request.SessionId);
                // Continuar com 0 se não conseguir obter
            }

            var response = await _faceMatchService.MatchFromLivenessAsync(request, livenessScore);
            return Ok(response);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Erro ao fazer match from liveness");
            return StatusCode(500, new { message = "Erro ao processar match com documento", error = ex.Message });
        }
    }
}


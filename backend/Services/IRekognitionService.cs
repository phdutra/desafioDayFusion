using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface IRekognitionService
{
    Task<FaceComparisonResponse> CompareFacesAsync(FaceComparisonRequest request);
    Task<bool> DetectFacesAsync(string imageKey);
    Task<float> GetFaceSimilarityAsync(string sourceImageKey, string targetImageKey);
    Task<string?> IndexFaceAsync(string imageKey, string externalImageId, CancellationToken cancellationToken = default);
    Task<FaceMatchResult> SearchFaceByImageAsync(string imageKey, string? expectedFaceId, float similarityThreshold, CancellationToken cancellationToken = default);
    Task<bool> DeleteFaceAsync(string faceId, CancellationToken cancellationToken = default);
    
    // Face Liveness 3D
    Task<LivenessSessionResponse> StartFaceLivenessSessionAsync(StartLivenessRequest request);
    Task<LivenessResultResponse> GetFaceLivenessSessionResultsAsync(GetLivenessResultRequest request);
}

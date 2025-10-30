using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface IRekognitionService
{
    Task<FaceComparisonResponse> CompareFacesAsync(FaceComparisonRequest request);
    Task<bool> DetectFacesAsync(string imageKey);
    Task<float> GetFaceSimilarityAsync(string sourceImageKey, string targetImageKey);
}

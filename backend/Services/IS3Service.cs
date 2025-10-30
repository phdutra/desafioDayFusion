using DayFusion.API.Models;

namespace DayFusion.API.Services;

public interface IS3Service
{
    Task<PresignedUrlResponse> GeneratePresignedPutUrlAsync(PresignedUrlRequest request);
    Task<PresignedUrlResponse> GeneratePresignedGetUrlAsync(string key, TimeSpan expiry);
    Task<bool> DeleteObjectAsync(string key);
    Task<bool> ObjectExistsAsync(string key);
    Task<PresignedUrlResponse> UploadObjectAsync(Stream content, string fileName, string? contentType, string? transactionId);
}

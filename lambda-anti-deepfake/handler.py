"""
Lambda Anti-Deepfake Analysis
Stub inicial para análise de deepfake em vídeos

TODO: Implementar modelo real (TensorFlow/Hugging Face) em fase futura
"""

import json
import boto3
import os
import random
from typing import Dict, Any

# Configuração
s3_client = boto3.client('s3')
BUCKET = os.environ.get('S3_BUCKET', 'dayfusion-bucket')

# Thresholds (configuráveis via env vars)
REVIEW_THRESHOLD = float(os.environ.get('THRESHOLD_REVIEW', '0.30'))
REJECT_THRESHOLD = float(os.environ.get('THRESHOLD_REJECT', '0.60'))


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler para análise anti-deepfake
    
    Args:
        event: { "s3Key": "sessions/video-123.webm" }
        context: Lambda context
    
    Returns:
        {
            "DeepfakeScore": 0.12,
            "BlinkRate": 17.5,
            "BlinkPattern": "natural",
            "AudioSync": "ok",
            "Artifacts": [],
            "ModelVersion": "1.0.0-stub"
        }
    """
    try:
        print(f"🔍 Recebido evento: {json.dumps(event)}")
        
        s3_key = event.get('s3Key')
        if not s3_key:
            return error_response("s3Key não fornecido no evento")
        
        # Download do vídeo do S3
        print(f"⬇️ Baixando vídeo: {s3_key}")
        video_data = download_from_s3(s3_key)
        
        if not video_data:
            return error_response(f"Vídeo não encontrado ou vazio: {s3_key}")
        
        print(f"✅ Vídeo baixado: {len(video_data)} bytes")
        
        # Análise (stub inicial - substituir por modelo real)
        result = analyze_video(video_data)
        
        print(f"✅ Análise completa: {json.dumps(result)}")
        return result
        
    except Exception as e:
        print(f"❌ Erro durante análise: {str(e)}")
        import traceback
        traceback.print_exc()
        return error_response(str(e))


def download_from_s3(key: str) -> bytes:
    """Download de arquivo do S3"""
    try:
        response = s3_client.get_object(Bucket=BUCKET, Key=key)
        return response['Body'].read()
    except Exception as e:
        print(f"❌ Erro ao baixar do S3: {str(e)}")
        raise


def analyze_video(video_data: bytes) -> Dict[str, Any]:
    """
    Análise anti-deepfake (stub inicial)
    
    TODO: Implementar modelo TensorFlow/Hugging Face real com:
    - Análise de padrão de piscadas (blink detection)
    - Sincronismo áudio-vídeo (lip-sync)
    - Detecção de artefatos GAN/diffusion
    - Microexpressões faciais
    
    Por enquanto, retorna score aleatório baixo (simulando vídeos naturais)
    """
    
    # Simular análise baseada no tamanho do vídeo (stub)
    video_size_mb = len(video_data) / (1024 * 1024)
    print(f"📊 Analisando vídeo de {video_size_mb:.2f} MB")
    
    # Score aleatório favorecendo vídeos naturais (maioria < 0.30)
    # Distribuição: 80% natural (<0.30), 15% suspeito (0.30-0.60), 5% deepfake (>0.60)
    rand = random.random()
    if rand < 0.80:
        # Natural
        deepfake_score = random.uniform(0.05, 0.28)
        blink_pattern = "natural"
        audio_sync = "ok"
        artifacts = []
    elif rand < 0.95:
        # Suspeito
        deepfake_score = random.uniform(0.30, 0.58)
        blink_pattern = random.choice(["natural", "anomalous"])
        audio_sync = random.choice(["ok", "lag"])
        artifacts = random.sample(["temporal_inconsistency", "compression_artifacts"], k=random.randint(0, 2))
    else:
        # Deepfake
        deepfake_score = random.uniform(0.60, 0.95)
        blink_pattern = "anomalous"
        audio_sync = random.choice(["lag", "mismatch"])
        artifacts = random.sample(["gan_edges", "warping", "temporal_inconsistency", "face_blending"], k=random.randint(2, 4))
    
    # Blink rate: 15-25 piscadas/min é normal
    blink_rate = random.uniform(12.0, 28.0) if blink_pattern == "natural" else random.uniform(5.0, 35.0)
    
    result = {
        'DeepfakeScore': round(deepfake_score, 2),
        'BlinkRate': round(blink_rate, 1),
        'BlinkPattern': blink_pattern,
        'AudioSync': audio_sync,
        'Artifacts': artifacts,
        'ModelVersion': '1.0.0-stub'
    }
    
    # Log de alerta para scores altos
    if deepfake_score >= REJECT_THRESHOLD:
        print(f"🚨 HIGH RISK deepfake detected! Score: {deepfake_score}")
    elif deepfake_score >= REVIEW_THRESHOLD:
        print(f"⚠️ MEDIUM RISK detected. Score: {deepfake_score}")
    else:
        print(f"✅ LOW RISK video. Score: {deepfake_score}")
    
    return result


def error_response(message: str) -> Dict[str, Any]:
    """Retorna resposta de erro neutra (não bloqueia transação)"""
    return {
        'DeepfakeScore': 0.5,  # score neutro
        'BlinkRate': 0.0,
        'BlinkPattern': 'error',
        'AudioSync': 'error',
        'Artifacts': ['analysis_error'],
        'ModelVersion': 'error',
        'ErrorMessage': message
    }


# Para testes locais
if __name__ == '__main__':
    # Teste local
    test_event = {
        's3Key': 'sessions/test-video.webm'
    }
    
    print("🧪 Teste local do Lambda")
    result = handler(test_event, None)
    print(f"Resultado: {json.dumps(result, indent=2)}")


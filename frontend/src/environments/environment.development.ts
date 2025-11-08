export const environment = {
  production: false,
  apiUrl: 'https://localhost:7197/api', // HTTPS necessário para WebRTC e liveness
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:2276b22e-33a1-4875-896e-1ec85d5debca',
    bucket: 'dayfusion-bucket'
  }
};

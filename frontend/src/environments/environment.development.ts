export const environment = {
  production: false,
  apiUrl: 'http://localhost:5100/api', // Backend ainda pode ser HTTP, mas frontend precisa HTTPS para WebRTC
  aws: {
    region: 'us-east-1',
    identityPoolId: 'us-east-1:2276b22e-33a1-4875-896e-1ec85d5debca'
  }
};

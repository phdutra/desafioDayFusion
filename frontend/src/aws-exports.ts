// Configuração do Amplify v6 para Face Liveness
const awsmobile = {
  Auth: {
    Cognito: {
      identityPoolId: 'us-east-1:2276b22e-33a1-4875-896e-1ec85d5debca',
      allowGuestAccess: true,
    }
  }
};

export default awsmobile;

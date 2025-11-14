import { Injectable } from '@angular/core';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import { AwsCredentialIdentity, Provider } from '@aws-sdk/types';
import { environment } from '../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class CognitoService {
  private readonly credentialProvider: Provider<AwsCredentialIdentity>;
  private readonly region: string;
  private readonly identityPoolId: string;

  constructor() {
    const region = environment.aws?.region;
    const identityPoolId = environment.aws?.identityPoolId;

    if (!region || !identityPoolId) {
      throw new Error('Configuração AWS ausente: defina region e identityPoolId no environment.');
    }

    this.region = region;
    this.identityPoolId = identityPoolId;

    this.credentialProvider = fromCognitoIdentityPool({
      identityPoolId: this.identityPoolId,
      clientConfig: { region: this.region }
    });
  }

  getCredentialsProvider(): Provider<AwsCredentialIdentity> {
    return this.credentialProvider;
  }

  async getCredentials(forceRefresh = false): Promise<AwsCredentialIdentity> {
    if (forceRefresh) {
      await this.clearCachedIdentity();
    }

    return this.credentialProvider();
  }

  private async clearCachedIdentity(): Promise<void> {
    if (typeof window === 'undefined') {
      return;
    }

    const identityKey = `aws.cognito.identity-id.${this.region}.${this.identityPoolId}`;
    const providersKey = `aws.cognito.identity-providers.${this.region}.${this.identityPoolId}`;

    try {
      window.localStorage.removeItem(identityKey);
      window.localStorage.removeItem(providersKey);
    } catch (error) {
    }

    if (!('indexedDB' in window)) {
      return;
    }

    await new Promise<void>((resolve) => {
      const request = window.indexedDB.deleteDatabase('aws.cognito.identity');

      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    });

    console.info('[CognitoService] Cache Cognito limpo – novas credenciais serão geradas.');
  }
}


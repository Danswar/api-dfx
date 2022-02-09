import { ApiClient } from '@defichain/jellyfish-api-core';
import { AccountHistory, AccountResult } from '@defichain/jellyfish-api-core/dist/category/account';
import { BlockchainInfo } from '@defichain/jellyfish-api-core/dist/category/blockchain';
import { InWalletTransaction, UTXO } from '@defichain/jellyfish-api-core/dist/category/wallet';
import { JsonRpcClient } from '@defichain/jellyfish-api-jsonrpc';
import { ServiceUnavailableException } from '@nestjs/common';
import { Config } from 'src/config/config';
import { HttpService } from 'src/shared/services/http.service';
import { Util } from 'src/shared/util';

export enum NodeCommand {
  UNLOCK = 'walletpassphrase',
  SEND_UTXO = 'sendutxosfrom',
}

enum Chain {
  TEST = 'test',
  MAIN = 'main',
}

export class NodeClient {
  private chain: Chain = Chain.MAIN;
  private readonly client: ApiClient;

  constructor(private readonly http: HttpService, private readonly url: string) {
    this.client = this.createJellyfishClient();
    this.getChain().then((c) => (this.chain = c));
  }

  // common
  async getInfo(): Promise<BlockchainInfo> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo());
  }

  async getHistories(addresses: string[], fromBlock: number, toBlock: number): Promise<AccountHistory[]> {
    let results = [];
    for (const address of addresses) {
      results = results.concat(await this.getHistory(address, fromBlock, toBlock));
    }
    return results;
  }

  private async getHistory(address: string, fromBlock: number, toBlock: number): Promise<AccountHistory[]> {
    return this.callNode((c) =>
      c.account.listAccountHistory(address, {
        depth: toBlock - fromBlock,
        maxBlockHeight: toBlock,
      }),
    );
  }

  async waitForTx(txId: string, timeout = 600000): Promise<InWalletTransaction> {
    const tx = await Util.poll(
      () => this.callNode((c) => c.wallet.getTransaction(txId)),
      (t) => t?.confirmations > 0,
      5000,
      timeout,
    );

    if (!(tx?.confirmations > 0)) throw new ServiceUnavailableException('Wait for TX timed out');
    return tx;
  }

  async getAddressesWithFunds(): Promise<string[]> {
    const [utxo, token] = await Promise.all([
      this.getUtxo().then((i) =>
        i.filter((u) => u.amount.toNumber() >= Config.node.minDfiDeposit).map((u) => u.address),
      ),
      this.getToken().then((i) => i.map((u) => u.owner)),
    ]);
    return [...new Set(utxo.concat(token))];
  }

  // UTXO
  async getUtxo(): Promise<UTXO[]> {
    return this.callNode((c) => c.wallet.listUnspent());
  }

  async sendUtxo(addressFrom: string, addressTo: string, amount: number): Promise<string> {
    return this.callNode(
      (c) => c.call(NodeCommand.SEND_UTXO, [addressFrom, addressTo, this.roundAmount(amount - this.utxoFee)], 'number'),
      true,
    );
  }

  // token
  async getToken(): Promise<AccountResult<string, string>[]> {
    return this.callNode((c) => c.account.listAccounts({}, false, { indexedAmounts: false, isMineOnly: true }));
  }

  async testCompositeSwap(address: string, tokenFrom: string, tokenTo: string, amount: number): Promise<number> {
    if (tokenFrom === tokenTo) return amount;

    return this.callNode((c) =>
      c.call(
        'testpoolswap',
        [
          {
            from: address,
            tokenFrom: tokenFrom,
            amountFrom: this.roundAmount(amount),
            to: address,
            tokenTo: tokenTo,
          },
          'auto',
        ],
        'number',
      ),
    ).then((r: string) => this.parseAmount(r).amount);
  }

  async sendToken(addressFrom: string, addressTo: string, token: string, amount: number, utxo: any = []): Promise<string> {
    return this.callNode((c) => c.account.accountToAccount(addressFrom, { [addressTo]: `${amount}@${token}` }, utxo), true);
  }

  // forwarding
  async sendRpcCommand(command: string): Promise<any> {
    return this.http.post(this.url, command, {
      headers: { ...this.createHeaders(), 'Content-Type': 'text/plain' },
    });
  }

  async sendCliCommand(command: string, noAutoUnlock?: boolean): Promise<any> {
    const cmdParts = command.split(' ');

    const method = cmdParts.shift();
    const params = cmdParts.map((p) => JSON.parse(p));

    return this.callNode((c) => c.call(method, params, 'number'), !noAutoUnlock);
  }

  // generic
  async call<T>(call: (client: ApiClient) => Promise<T>): Promise<T> {
    return this.callNode<T>(call);
  }

  parseAmount(amount: string): { amount: number; asset: string } {
    return {
      amount: +amount.split('@')[0],
      asset: amount.split('@')[1],
    };
  }

  // --- HELPER METHODS --- //
  private async callNode<T>(call: (client: ApiClient) => Promise<T>, unlock = false): Promise<T> {
    try {
      if (unlock) await this.unlock();
      return await call(this.client);
    } catch (e) {
      // TODO: retries?
      console.log('Exception during node call:', e);
      throw new ServiceUnavailableException(e);
    }
  }

  private async unlock(timeout = 10): Promise<any> {
    return this.client.call(NodeCommand.UNLOCK, [Config.node.walletPassword, timeout], 'number');
  }

  private createJellyfishClient(): ApiClient {
    return new JsonRpcClient(this.url, { headers: this.createHeaders() });
  }

  private createHeaders(): { [key: string]: string } {
    const passwordHash = Buffer.from(`${Config.node.user}:${Config.node.password}`).toString('base64');
    return { Authorization: 'Basic ' + passwordHash };
  }

  private async getChain(): Promise<Chain> {
    return this.callNode((c) => c.blockchain.getBlockchainInfo()).then((i) => i.chain as Chain);
  }

  private get utxoFee(): number {
    return this.chain === Chain.MAIN ? 0.00000132 : 0.0000222;
  }

  private roundAmount(amount: number): number {
    return Util.round(amount, 8);
  }
}

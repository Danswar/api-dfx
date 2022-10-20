import { GetConfig } from 'src/config/config';
import { MailContext } from 'src/notification/enums';
import { NotificationMetadata, NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export type ErrorMonitoringMailInput = ErrorMonitoringMailParams;

export interface ErrorMonitoringMailParams {
  subject: string;
  errors: string[];
  metadata?: NotificationMetadata;
  options?: NotificationOptions;
}

export class ErrorMonitoringMail extends Mail {
  constructor(params: ErrorMonitoringMailParams) {
    const to = [GetConfig().mail.contact.monitoringMail];
    ErrorMonitoringMail.isLiqMail(params) && to.push(GetConfig().mail.contact.liqMail);

    const _params = {
      to: to,
      subject: `${params.subject} (${GetConfig().environment.toUpperCase()})`,
      salutation: 'Hi DFX Tech Support',
      body: ErrorMonitoringMail.createBody(params.errors),
      metadata: params.metadata,
      options: params.options,
    };

    super(_params);
  }

  private static isLiqMail(params: ErrorMonitoringMailParams): boolean {
    return [MailContext.BUY_CRYPTO, MailContext.DEX, MailContext.PAYOUT, MailContext.PRICING].includes(
      params.metadata?.context,
    );
  }

  static createBody(errors: string[]): string {
    const env = GetConfig().environment.toUpperCase();

    return `
    <p>there seem to be some problems on ${env} API:</p>
    <ul>
      ${errors.reduce((prev, curr) => prev + '<li>' + curr + '</li>', '')}
    </ul>
    `;
  }
}

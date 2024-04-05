import { Language } from 'src/shared/models/language/language.entity';
import { MailAffix, TranslationItem } from '../../interfaces';
import { NotificationOptions } from '../notification.entity';
import { Mail } from './base/mail';

export interface MailRequestPersonalInput {
  userData: { id: number; mail: string; language: Language };
  title: string;
  salutation?: TranslationItem;
  prefix?: TranslationItem[];
  from?: string;
  displayName?: string;
  banner?: string;
}

export interface PersonalMailParams {
  to: string;
  subject: string;
  prefix: MailAffix[];
  banner: string;
  from?: string;
  displayName?: string;
  correlationId?: string;
  options?: NotificationOptions;
}

export class PersonalMail extends Mail {
  constructor(params: PersonalMailParams) {
    super({ ...params, template: 'personal', templateParams: params });
  }
}

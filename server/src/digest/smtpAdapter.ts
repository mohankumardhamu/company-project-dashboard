import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';
import type { DigestAdapter, DigestMessage } from './adapter';

let transport: Transporter | null = null;

function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    });
  }
  return transport;
}

export function createSmtpAdapter(): DigestAdapter {
  return {
    name: 'smtp',
    async send(message: DigestMessage) {
      await getTransport().sendMail({
        from: env.smtpFrom,
        to: message.to.join(', '),
        subject: message.subject,
        text: `${message.scopeLabel}\n${message.period.from} to ${message.period.to}\n\nThe bi-weekly workbook is attached.`,
        attachments: [
          {
            filename: message.filename,
            content: message.workbook,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      });
    },
  };
}

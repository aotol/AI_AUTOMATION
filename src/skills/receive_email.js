const imaps = require('imap-simple');
const { findPreviousOutputByKey } = require('../skill-utils');
const {
  simpleParser
} = require('mailparser');

module.exports = {
  stepName: 'receive_email',
  requiresAI: false,
  payloadDefinition: {
    count: 'Number of latest emails to retrieve (default: 1). If inbox has fewer emails, return all available.'
  },
  description: 'Retrieve the latest emails from the inbox.',

  execute: async (context, services, stepDefinition) => {
    const {
      config
    } = require('../config');
    let emailCount = stepDefinition.payload ? stepDefinition.payload.count : findPreviousOutputByKey(context, "count");
    if (!emailCount) {
      emailCount = 1;
    }
    if (!Number.isInteger(emailCount) || emailCount < 1) {
      throw new Error('receive_email count must be a positive integer');
    }

    if (!config.email || !config.email.imap) {
      throw new Error('IMAP configuration not found in config.json');
    }

    const imapConfig = config.email.imap;
    const imapcfg = {
      imap: {
        user: imapConfig.user,
        password: imapConfig.password,
        host: imapConfig.host,
        port: imapConfig.port,
        tls: imapConfig.tls,
        authTimeout: 3000
      }
    };

    try {
      console.log('[EMAIL-RECEIVE] Connecting to IMAP server...');
      const connection = await imaps.connect(imapcfg);

      console.log('[EMAIL-RECEIVE] Opening inbox...');
      const box = await connection.openBox('INBOX');
      const totalEmails = box.messages.total;

      if (totalEmails === 0) {
        await connection.end();
        return {
          count: 0,
          emails: [],
          message: 'No emails in inbox'
        };
      }

      const start = Math.max(1, totalEmails - (emailCount - 1));
      const searchCriteria = [`${start}:${totalEmails}`];

      console.log(`[EMAIL-RECEIVE] Fetching range: ${searchCriteria}...`);

      const messages = await connection.search(searchCriteria, {
        bodies: [''],
        struct: true
      });

      const latestMessages = messages.reverse();

      const emails = await Promise.all(latestMessages.map(async (msg) => {
        // Find the part where which is an empty string
        const rawPart = msg.parts.find(part => part.which === '');

        if (!rawPart) {
          console.error(`[EMAIL-RECEIVE] Raw body not found for UID: ${msg.attributes.uid}`);
          return null;
        }

        const parsed = await simpleParser(rawPart.body);

        return {
          uid: msg.attributes.uid,
          from: parsed.from?.text || 'Unknown',
          to: parsed.to?.text || 'Unknown',
          subject: parsed.subject || '(no subject)',
          text: (parsed.text || '').substring(0, 500), // Cleaned plain text
          date: parsed.date || new Date().toISOString(),
          size: msg.attributes.size
        };
      }));

      const finalEmails = emails.filter(e => e !== null);

      await connection.end();

      return {
        count: finalEmails.length,
        emails: finalEmails,
        message: `Retrieved ${finalEmails.length} email(s) from inbox`
      };
    } catch (err) {
      console.error('[EMAIL-RECEIVE] Error:', err);
      throw err;
    }
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];

    if (!result || typeof result !== 'object') {
      errors.push('receive_email result must be an object.');
    }

    if (typeof result.count !== 'number' || result.count < 0) {
      errors.push('receive_email count must be a non-negative number.');
    }

    if (!Array.isArray(result.emails)) {
      errors.push('receive_email emails must be an array.');
    }

    if (result.emails && result.emails.length > 0) {
      for (const email of result.emails) {
        if (!email.from || !email.subject) {
          errors.push('Each email must contain from and subject fields.');
          break;
        }
      }
    }

    if (!result.message || typeof result.message !== 'string') {
      errors.push('receive_email result must include a status message.');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
};
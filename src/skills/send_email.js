module.exports = {
  stepName: 'send_email',
  requiresAI: false,
  payloadDefinition: {
    address: 'The recipient email address.',
    subject: 'Email subject.'
  },
  description: 'Send email with task results to the specified recipient.',
  
  execute: async (context, services, stepDefinition) => {
    const { findPreviousOutputByKey } = require('../skill-utils');
    const { config } = require('../config');
    const nodemailer = require('nodemailer');
    
    const recipientAddress = stepDefinition.payload && stepDefinition.payload.address;
    if (!recipientAddress || typeof recipientAddress !== 'string') {
      throw new Error('send_email step requires payload.address');
    }

    // Get email subject from payload or use task goal
    const subject = (stepDefinition.payload && stepDefinition.payload.subject)
      || context.rawInput
      || 'Task Results';

    // Get email body from previous step outputs

    let emailBody = findPreviousOutputByKey(context, "text");
    if (!emailBody || emailBody.trim() == '') {
      emailBody  = JSON.stringify(context.stepResults.map(s => s.output), null, 2) || 'No content to send.';
    }

    // Get SMTP config and sender info from config.json
    if (!config.email || !config.email.smtp) {
      throw new Error('Email configuration not found in config.json');
    }

    const smtpConfig = config.email.smtp;
    const senderEmail = config.email.smtp.auth.user;
    const senderName = config.email.smtp.name || 'AI Automation Framework';
    const transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: smtpConfig.auth
    });
    
    // Send email
    const result = await transporter.sendMail({
      from: `${senderName} <${senderEmail}>`,
      to: recipientAddress,
      subject,
      text: emailBody
    });

    console.log(`[EMAIL] Sent successfully, message ID: ${result.messageId}`);

    return {
      sent: true,
      from: senderEmail,
      to: recipientAddress,
      subject,
      timestamp: new Date().toISOString(),
      messageId: result.messageId,
      message: `Email sent successfully to ${recipientAddress}`
    };
  },
  validate: async (context, result, stepDefinition) => {
    const errors = [];
    
    if (!result || typeof result !== 'object') {
      errors.push('send_email result must be an object.');
    }
    
    if (result.sent !== true) {
      errors.push('send_email result must have sent: true.');
    }
    
    if (!result.to || typeof result.to !== 'string') {
      errors.push('send_email result must include recipient address in to field.');
    }
    
    if (!result.message || typeof result.message !== 'string') {
      errors.push('send_email result must include a status message.');
    }

    return { valid: errors.length === 0, errors };
  }
};


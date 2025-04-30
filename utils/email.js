const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

exports.sendBotSuccessEmail = async (to, botId) => {
  const mailOptions = {
    from: `"CryptoBot Pro" <${process.env.SMTP_USER}>`,
    to,
    subject: "Your Trading Bot is Ready ",
    html: `
      <h2>🎉 Payment Received</h2>
      <p>Thank you for purchasing the <strong>${botId}</strong> bot.</p>
      <p>Your bot instance has been created and is now active in your dashboard.</p>
      <br/>
      <a href="https://yourfrontend.com/dashboard" style="padding:10px 20px;background:#1a73e8;color:white;border-radius:6px;text-decoration:none;">Go to Dashboard</a>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`📧 Email sent to ${to}`);
  } catch (err) {
    console.error("❌ Failed to send email:", err.message);
  }
};

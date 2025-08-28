import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { exportResumeDocx, exportResumePdf } from './resumeExport';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendResumeWithFiles(resume: any) {
  // Generate DOCX and PDF from the provided resume data
  const docxPath = await exportResumeDocx(resume, 'resume.docx');
  const pdfPath = exportResumePdf(resume, 'resume.pdf');

  const user = 'cv.builder.agent@gmail.com';
  const pass = 'rvnzegpctdrkfzfp';
  const recipient = resume.email; // Uses email from landing page

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  const attachments = [];
  if (docxPath && fs.existsSync(docxPath)) {
    attachments.push({ filename: path.basename(docxPath), path: docxPath });
  }
  if (pdfPath && fs.existsSync(pdfPath)) {
    attachments.push({ filename: path.basename(pdfPath), path: pdfPath });
  }

  const mailOptions = {
    from: user,
    to: recipient,
    subject: 'Your Resume from CV Agent',
    text: 'Attached are your resume files (DOCX and PDF).',
    attachments,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent:', info.response);
    return info;
  } catch (error) {
    console.error('Error sending email:', error);
    throw error;
  }
}

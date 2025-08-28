/* eslint-disable @typescript-eslint/no-explicit-any */

import { Document, Packer, Paragraph, TextRun } from 'docx';
import jsPDF from 'jspdf';

export async function exportResumeDocx(resume: any) {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: resume.name || '', bold: true, size: 32 }),
              new TextRun({ text: `\n${resume.email || ''} | ${resume.phone || ''}`, size: 24 })
            ]
          }),
          resume.summary ? new Paragraph({ text: resume.summary }) : null,
          resume.experiences && resume.experiences.length > 0 ? new Paragraph({ text: 'Experience', heading: 'Heading1' }) : null,
          ...(resume.experiences || []).map((exp: any) =>
            new Paragraph({
              children: [
                new TextRun({ text: `${exp.title || ''} at ${exp.company || ''} (${exp.duration || ''})`, bold: true }),
                ...((exp.description || []).map((desc: any) => new TextRun({ text: `\n• ${desc}` })))
              ]
            })
          ),
          resume.skills && resume.skills.length > 0 ? new Paragraph({ text: 'Skills', heading: 'Heading1' }) : null,
          ...(resume.skills || []).map((skill: any) =>
            new Paragraph({
              children: [
                new TextRun({ text: skill, bold: false })
              ]
            })
          )
        ].filter(Boolean)
      }
    ]
  });

  const outputPath = path.join(__dirname, '../assets', outputFileName);
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  console.log('DOCX resume created at', outputPath);
  return outputPath;
}

export function exportResumePdf(resume: any, outputFileName = 'resume.pdf') {
  const doc = new jsPDF();
  let yPosition = 20;

  // Name
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text(resume.name || '', 20, yPosition);
  yPosition += 15;

  // Contact
  doc.setFontSize(16);
  doc.setFont('helvetica', 'normal');
  doc.text(`${resume.email || ''} | ${resume.phone || ''}`, 20, yPosition);
  yPosition += 20;

  // Summary
  if (resume.summary) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Professional Summary', 20, yPosition);
    yPosition += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const summaryLines = doc.splitTextToSize(resume.summary, 170);
    doc.text(summaryLines, 20, yPosition);
    yPosition += summaryLines.length * 5 + 10;
  }

  // Experience
  if (resume.experiences && resume.experiences.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Experience', 20, yPosition);
    yPosition += 10;

    resume.experiences.forEach((exp: any) => {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`${exp.title || ''} at ${exp.company || ''} (${exp.duration || ''})`, 20, yPosition);
      yPosition += 8;

      doc.setFont('helvetica', 'normal');
      (exp.description || []).forEach((desc: any) => {
        doc.text(`• ${desc}`, 30, yPosition);
        yPosition += 6;
      });
      yPosition += 5;
    });
  }

  // Skills
  if (resume.skills && resume.skills.length > 0) {
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Skills', 20, yPosition);
    yPosition += 10;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.text(resume.skills.join(', '), 20, yPosition);
  }

  // Save the PDF
  doc.save(outputFileName);
  return outputFileName; // For consistency, but jsPDF handles the download
}

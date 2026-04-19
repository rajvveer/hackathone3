const cloudinary = require('cloudinary').v2;
const { PDFParse } = require('pdf-parse');
const Groq = require('groq-sdk');
const { MODELS } = require('../config/constants');

// ── Configure Cloudinary ───────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Groq client for vision
const groq = process.env.GROQ_API_KEY
  ? new Groq({ apiKey: process.env.GROQ_API_KEY })
  : null;

class FileUploadService {
  /**
   * Upload an image buffer to Cloudinary.
   * Returns { url, publicId, format, bytes }
   */
  async uploadImage(fileBuffer, originalName = 'medical_doc') {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'curalink/medical-docs',
          resource_type: 'image',
          public_id: `${originalName.replace(/\.[^.]+$/, '')}_${Date.now()}`,
          transformation: [
            { quality: 'auto', fetch_format: 'auto' }
          ]
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            bytes: result.bytes,
            width: result.width,
            height: result.height,
          });
        }
      );
      stream.end(fileBuffer);
    });
  }

  /**
   * Extract text from a PDF buffer using pdf-parse.
   * Returns { text, pages, info }
   */
  async extractPdfText(fileBuffer) {
    let parser = null;
    try {
      parser = new PDFParse({ data: fileBuffer });
      
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo();
      
      return {
        text: textResult.text || '',
        pages: infoResult.total || 0,
        info: infoResult.info || {},
      };
    } catch (error) {
      console.error('PDF parse error:', error.message);
      throw new Error(`Failed to parse PDF: ${error.message}`);
    } finally {
      if (parser) {
        await parser.destroy();
      }
    }
  }

  /**
   * Use Groq Vision (Llama 3.2 90B Vision) to read text/content from a medical document image.
   * Returns extracted text description.
   */
  async analyzeImageWithVision(imageUrl) {
    if (!groq) throw new Error('Groq client not initialized — set GROQ_API_KEY');

    const systemPrompt = `You are a medical document reader. The user has uploaded a photo of a medical document (lab report, prescription, discharge summary, scan result, etc.).

YOUR TASK:
1. Read ALL text visible in the image carefully
2. Identify the document type (lab report, prescription, radiology report, discharge summary, etc.)
3. Extract ALL values, numbers, test names, medications, and findings
4. Preserve the structure (headers, sections, tables) as much as possible
5. If there are reference ranges, include them
6. Note any handwritten text if legible

OUTPUT FORMAT:
Return the extracted content as structured text. Use markdown-like formatting:
- Use headers for sections
- Use tables for lab values (Test | Value | Reference Range | Status)
- List medications with dosages
- Note any critical or abnormal values with ⚠️

Be thorough — extract EVERYTHING visible. This will be analyzed by an AI medical assistant.`;

    try {
      const completion = await groq.chat.completions.create({
        model: MODELS.VISION,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Please read and extract all content from this medical document image.' },
              { type: 'image_url', image_url: { url: imageUrl } }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }, { timeout: 30000 });

      return completion.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Vision analysis error:', error.message);
      throw new Error(`Vision analysis failed: ${error.message}`);
    }
  }

  /**
   * Process an uploaded file — route to correct handler based on mimetype.
   * Returns { type, extractedText, fileInfo }
   */
  async processFile(fileBuffer, mimetype, originalName) {
    const isPdf = mimetype === 'application/pdf';
    const isImage = mimetype.startsWith('image/');

    if (!isPdf && !isImage) {
      throw new Error('Unsupported file type. Please upload a PDF or image (JPG, PNG, WEBP).');
    }

    if (isPdf) {
      console.log(`📄 Processing PDF: ${originalName} (${fileBuffer.length} bytes)`);
      const pdfData = await this.extractPdfText(fileBuffer);
      
      if (!pdfData.text || pdfData.text.trim().length < 10) {
        throw new Error('Could not extract text from PDF. The file may be scanned/image-based. Try uploading a photo instead.');
      }

      return {
        type: 'pdf',
        extractedText: pdfData.text,
        fileInfo: {
          name: originalName,
          pages: pdfData.pages,
          size: fileBuffer.length,
          mimeType: mimetype,
        }
      };
    }

    // Image — upload to Cloudinary, then use Vision to read it
    console.log(`🖼️ Processing image: ${originalName} (${fileBuffer.length} bytes)`);
    const cloudinaryResult = await this.uploadImage(fileBuffer, originalName);
    console.log(`☁️ Cloudinary upload OK: ${cloudinaryResult.url}`);

    const extractedText = await this.analyzeImageWithVision(cloudinaryResult.url);
    console.log(`👁️ Vision extracted ${extractedText.length} chars from image`);

    return {
      type: 'image',
      extractedText,
      fileInfo: {
        name: originalName,
        url: cloudinaryResult.url,
        publicId: cloudinaryResult.publicId,
        size: fileBuffer.length,
        mimeType: mimetype,
        width: cloudinaryResult.width,
        height: cloudinaryResult.height,
      }
    };
  }
}

module.exports = new FileUploadService();

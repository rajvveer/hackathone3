import React, { useState, useRef, useCallback } from 'react';

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

const FILE_ICONS = {
  'application/pdf': '📄',
  'image/jpeg': '🖼️',
  'image/jpg': '🖼️',
  'image/png': '🖼️',
  'image/webp': '🖼️',
};

export default function FileUpload({ onUpload, onClose, disabled }) {
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [userQuery, setUserQuery] = useState('');
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef(null);

  const validateFile = (file) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return 'Invalid file type. Only PDF, JPG, PNG, and WEBP are allowed.';
    }
    if (file.size > MAX_SIZE) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum is 10MB.`;
    }
    return null;
  };

  const handleFile = useCallback((file) => {
    setError('');
    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSelectedFile(file);

    // Generate preview for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => setPreview(e.target.result);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  }, []);

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, [handleFile]);

  const handleInputChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleSubmit = async () => {
    if (!selectedFile || uploading || disabled) return;
    setUploading(true);
    setUploadProgress(10);

    // Simulate progress ticks while upload is happening
    const progressInterval = setInterval(() => {
      setUploadProgress(prev => Math.min(prev + Math.random() * 15, 85));
    }, 500);

    try {
      await onUpload(selectedFile, userQuery);
      setUploadProgress(100);
      clearInterval(progressInterval);
      // Close after short delay
      setTimeout(() => {
        onClose();
      }, 400);
    } catch (err) {
      clearInterval(progressInterval);
      setError(err.message || 'Upload failed. Please try again.');
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setPreview(null);
    setError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="file-upload-overlay" onClick={onClose}>
      <div className="file-upload-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="file-upload-header">
          <div className="file-upload-header-left">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <h3>Upload Medical Document</h3>
          </div>
          <button className="file-upload-close" onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
              <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Drop Zone */}
        {!selectedFile ? (
          <div
            className={`file-drop-zone ${dragActive ? 'active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleInputChange}
              className="file-input-hidden"
              id="medical-file-input"
            />
            <div className="drop-zone-content">
              <div className="drop-zone-icon">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <path d="M21 15V19C21 20.1 20.1 21 19 21H5C3.9 21 3 20.1 3 19V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <polyline points="17,8 12,3 7,8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <p className="drop-zone-text">
                {dragActive ? 'Drop your file here' : 'Drag & drop your medical document'}
              </p>
              <p className="drop-zone-subtext">or click to browse</p>
              <div className="drop-zone-types">
                <span className="type-badge">PDF</span>
                <span className="type-badge">JPG</span>
                <span className="type-badge">PNG</span>
                <span className="type-badge">WEBP</span>
                <span className="type-badge-size">Max 10MB</span>
              </div>
            </div>
          </div>
        ) : (
          /* File Preview */
          <div className="file-preview-area">
            <div className="file-preview-card">
              {preview ? (
                <div className="file-preview-image">
                  <img src={preview} alt="Preview" />
                </div>
              ) : (
                <div className="file-preview-icon">
                  <span>{FILE_ICONS[selectedFile.type] || '📄'}</span>
                </div>
              )}
              <div className="file-preview-info">
                <span className="file-preview-name">{selectedFile.name}</span>
                <span className="file-preview-meta">
                  {formatSize(selectedFile.size)} · {selectedFile.type.split('/')[1].toUpperCase()}
                </span>
              </div>
              {!uploading && (
                <button className="file-remove-btn" onClick={handleRemoveFile} aria-label="Remove file">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                </button>
              )}
            </div>

            {/* Optional query */}
            {!uploading && (
              <div className="file-query-input">
                <input
                  type="text"
                  placeholder="Ask a specific question about this document (optional)"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="file-query-field"
                  id="file-query-input"
                />
              </div>
            )}

            {/* Progress bar */}
            {uploading && (
              <div className="upload-progress-container">
                <div className="upload-progress-bar">
                  <div
                    className="upload-progress-fill"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <span className="upload-progress-text">
                  {uploadProgress < 30 ? 'Uploading file...' :
                   uploadProgress < 60 ? 'Extracting content...' :
                   uploadProgress < 90 ? 'AI analyzing document...' :
                   'Complete!'}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="file-upload-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 4.5V8.5M8 10.5V11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <span>{error}</span>
          </div>
        )}

        {/* Footer */}
        <div className="file-upload-footer">
          <button className="file-cancel-btn" onClick={onClose} disabled={uploading}>
            Cancel
          </button>
          <button
            className={`file-submit-btn ${selectedFile && !uploading ? 'active' : ''}`}
            onClick={handleSubmit}
            disabled={!selectedFile || uploading || disabled}
            id="file-submit-btn"
          >
            {uploading ? (
              <>
                <span className="btn-spinner" />
                Analyzing...
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Analyze Document
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

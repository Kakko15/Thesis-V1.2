import { useState, useRef } from 'react'
import { uploadPaper } from '../api'
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react'

function UploadPage() {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState('')
  const [abstract, setAbstract] = useState('')
  const [adminSecret, setAdminSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [toast, setToast] = useState(null)
  const [progress, setProgress] = useState(null)
  const fileInputRef = useRef(null)

  const showToast = (type, message) => {
    setToast({ type, message })
    setTimeout(() => setToast(null), 5000)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    setDragging(false)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile)
    } else {
      showToast('error', 'Please drop a PDF file only.')
    }
  }

  const handleFileChange = (e) => {
    const selected = e.target.files[0]
    if (selected) {
      if (selected.type !== 'application/pdf') {
        showToast('error', 'Please select a PDF file only.')
        return
      }
      setFile(selected)
    }
  }

  const handleRemoveFile = (e) => {
    e.stopPropagation()
    setFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!file) {
      showToast('error', 'Please select a PDF file.')
      return
    }
    if (!title.trim()) {
      showToast('error', 'Please enter a title.')
      return
    }

    try {
      setLoading(true)
      setProgress('Uploading and extracting text...')

      // Simulate progress stages
      const progressTimer = setTimeout(() => {
        setProgress('Chunking text and generating embeddings...')
      }, 2000)

      const progressTimer2 = setTimeout(() => {
        setProgress('Storing in vector database...')
      }, 5000)

      const result = await uploadPaper(file, title.trim(), authors.trim(), year.trim(), abstract.trim(), adminSecret)

      clearTimeout(progressTimer)
      clearTimeout(progressTimer2)

      showToast('success', `"${title}" uploaded successfully! ${result.chunks} chunks created.`)

      // Reset form
      setFile(null)
      setTitle('')
      setAuthors('')
      setYear('')
      setAbstract('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      setProgress(null)
    } catch (err) {
      console.error('Upload error:', err)
      const errorMsg = err.response?.data?.detail || 'Failed to upload paper. Check the backend connection.'
      showToast('error', errorMsg)
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / 1048576).toFixed(1) + ' MB'
  }

  return (
    <div className="page" id="upload-page">
      <div className="page-header">
        <h1>
          <Upload size={28} />
          Upload Thesis
        </h1>
        <p>Add a new thesis paper to the archive for RAG-powered search</p>
      </div>

      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 700 }}>
        {/* Drop Zone */}
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />

          {file ? (
            <>
              <CheckCircle className="drop-zone-icon" size={56} />
              <h3>File selected</h3>
              <div className="file-info">
                <FileText size={16} />
                <span>{file.name}</span>
                <span style={{ color: 'var(--text-tertiary)' }}>({formatFileSize(file.size)})</span>
                <button
                  type="button"
                  className="btn btn-icon btn-secondary btn-sm"
                  onClick={handleRemoveFile}
                  style={{ marginLeft: 4 }}
                >
                  <X size={14} />
                </button>
              </div>
            </>
          ) : (
            <>
              <Upload className="drop-zone-icon" size={56} />
              <h3>Drop your PDF here or click to browse</h3>
              <p>Supports PDF files only</p>
            </>
          )}
        </div>

        {/* Form Fields */}
        <div style={{ marginTop: 24 }}>
          <div className="form-group">
            <label className="form-label">Title *</label>
            <input
              type="text"
              className="form-input"
              placeholder="Enter thesis title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
              disabled={loading}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Authors</label>
              <input
                type="text"
                className="form-input"
                placeholder="Author names"
                value={authors}
                onChange={e => setAuthors(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Year</label>
              <input
                type="number"
                className="form-input"
                placeholder="Publication year"
                value={year}
                onChange={e => setYear(e.target.value)}
                min="1900"
                max="2100"
                disabled={loading}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Abstract</label>
            <textarea
              className="form-textarea"
              placeholder="Brief abstract or summary (optional)"
              value={abstract}
              onChange={e => setAbstract(e.target.value)}
              disabled={loading}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Admin Secret *</label>
            <input
              type="password"
              className="form-input"
              placeholder="Enter admin secret to authorize upload"
              value={adminSecret}
              onChange={e => setAdminSecret(e.target.value)}
              required
              disabled={loading}
            />
          </div>
        </div>

        {/* Progress */}
        {loading && progress && (
          <div className="upload-progress">
            <div className="progress-bar-wrapper">
              <div className="progress-bar" style={{ width: '100%' }} />
            </div>
            <div className="progress-text">
              <span className="loading-spinner" />
              {progress}
            </div>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          className="btn btn-primary btn-lg"
          disabled={loading || !file || !title.trim()}
          style={{ width: '100%', marginTop: 20 }}
        >
          {loading ? (
            <>
              <span className="loading-spinner" />
              Processing...
            </>
          ) : (
            <>
              <Upload size={20} />
              Upload & Process
            </>
          )}
        </button>
      </form>

      {/* Toast */}
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle size={18} /> : <AlertCircle size={18} />}
          {toast.message}
        </div>
      )}
    </div>
  )
}

export default UploadPage

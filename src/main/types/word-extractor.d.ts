declare module 'word-extractor' {
  class ExtractedDocument {
    getBody(): string
    getHeaders(): string
    getFooters(): string
    getEndnotes(): string
    getFootnotes(): string
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<ExtractedDocument>
  }
}

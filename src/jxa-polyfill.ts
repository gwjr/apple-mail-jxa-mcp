// URL polyfill for JXA
// JXA doesn't have the native URL constructor, so we provide a minimal implementation

// Only define if URL doesn't exist (avoids overriding in Node test environment)
if (typeof (globalThis as any).URL === 'undefined') {
  (globalThis as any).URL = class URL {
    href: string;
    protocol: string;
    pathname: string;
    search: string;
    hash: string;
    host: string;
    hostname: string;
    port: string;
    origin: string;

    constructor(url: string, base?: string | URL) {
      let fullUrl = url;
      if (base) {
        const baseStr = typeof base === 'string' ? base : base.href;
        // Simple base resolution - just prepend base if url is relative
        if (!url.includes('://')) {
          fullUrl = baseStr.replace(/\/[^/]*$/, '/') + url;
        }
      }

      this.href = fullUrl;

      // Parse the URL
      const schemeMatch = fullUrl.match(/^([a-z][a-z0-9+.-]*):\/\//i);
      if (!schemeMatch) {
        throw new TypeError(`Invalid URL: ${url}`);
      }

      this.protocol = schemeMatch[1] + ':';

      const afterScheme = fullUrl.slice(schemeMatch[0].length);

      // Split off hash
      const hashIdx = afterScheme.indexOf('#');
      const beforeHash = hashIdx >= 0 ? afterScheme.slice(0, hashIdx) : afterScheme;
      this.hash = hashIdx >= 0 ? afterScheme.slice(hashIdx) : '';

      // Split off search/query
      const searchIdx = beforeHash.indexOf('?');
      const beforeSearch = searchIdx >= 0 ? beforeHash.slice(0, searchIdx) : beforeHash;
      this.search = searchIdx >= 0 ? beforeHash.slice(searchIdx) : '';

      // For mail:// URLs, there's no host - everything is pathname
      // For http:// URLs, we'd parse host differently
      if (this.protocol === 'mail:') {
        this.host = '';
        this.hostname = '';
        this.port = '';
        this.origin = 'null';
        this.pathname = beforeSearch || '/';
      } else {
        // Basic parsing for other schemes - extract host from path
        const slashIdx = beforeSearch.indexOf('/');
        if (slashIdx >= 0) {
          this.host = beforeSearch.slice(0, slashIdx);
          this.pathname = beforeSearch.slice(slashIdx);
        } else {
          this.host = beforeSearch;
          this.pathname = '/';
        }
        // Parse hostname and port from host
        const colonIdx = this.host.lastIndexOf(':');
        if (colonIdx >= 0 && !this.host.includes(']')) {
          this.hostname = this.host.slice(0, colonIdx);
          this.port = this.host.slice(colonIdx + 1);
        } else {
          this.hostname = this.host;
          this.port = '';
        }
        this.origin = `${this.protocol}//${this.host}`;
      }
    }

    toString(): string {
      return this.href;
    }

    toJSON(): string {
      return this.href;
    }
  };
}

const Footer = () => (
  <footer className="py-8 text-center px-4 border-t border-border">
    <p className="text-xs text-muted-foreground/60 font-body max-w-xl mx-auto leading-relaxed">
      Season dates are approximate. Always verify current regulations with your state wildlife agency before hunting.
    </p>
    <p className="text-xs text-muted-foreground/40 font-body mt-2">
      © {new Date().getFullYear()} DuckCountdown.com
    </p>
  </footer>
);

export default Footer;

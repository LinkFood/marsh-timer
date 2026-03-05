import { motion } from "framer-motion";

const Header = () => (
  <motion.header
    className="pt-10 pb-6 text-center"
    initial={{ opacity: 0, y: -20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.6 }}
  >
    <div className="text-6xl mb-4">🦆</div>
    <h1 className="text-4xl md:text-6xl font-display font-black text-gradient-gold tracking-tight">
      DUCK COUNTDOWN
    </h1>
    <p className="mt-3 text-sm md:text-base tracking-[0.2em] uppercase text-muted-foreground font-body">
      Know before you go · Never miss an opener
    </p>
  </motion.header>
);

export default Header;

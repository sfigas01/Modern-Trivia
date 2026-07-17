import { useEffect } from 'react';
import { motion } from 'framer-motion';

const DISMISS_DELAY_MS = 2000;

export interface TurnHandoffProps {
  nickname: string;
  onDismiss: () => void;
}

export function TurnHandoff({ nickname, onDismiss }: TurnHandoffProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, DISMISS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      data-testid="turn-handoff"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="text-center"
      >
        <h2 className="text-3xl font-bold">It&rsquo;s {nickname}&rsquo;s turn!</h2>
      </motion.div>
    </motion.div>
  );
}

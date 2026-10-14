import * as React from "react";

/**
 * shadcn-style AlertDialog API, RAINCHECK dark theme.
 * Tokens: bg #0B1220, text #F4FEFF, accent #35E0FF, destructive #F87171.
 *
 * NOTE: self-contained implementation (no @radix-ui dependency — the
 * registry mirror cannot currently serve it; see F6 report). Same exported
 * API as shadcn's AlertDialog, so swapping to the Radix-backed version is a
 * drop-in file replacement. Behavior: role="alertdialog", aria-modal,
 * Escape cancels, overlay click cancels, focus moves to Cancel on open.
 * Destructive confirms use this — never window.confirm (design law §6).
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

interface DialogContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  tone: "default" | "destructive";
}
const DialogContext = React.createContext<DialogContextValue>({
  open: false,
  setOpen: () => {},
  tone: "default",
});

function AlertDialog({
  children,
  defaultOpen,
}: {
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(!!defaultOpen);
  return (
    <DialogContext.Provider value={{ open, setOpen, tone: "default" }}>
      {children}
    </DialogContext.Provider>
  );
}

function AlertDialogTrigger({
  children,
  className,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { setOpen } = React.useContext(DialogContext);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={(e) => {
        props.onClick?.(e);
        if (!disabled) setOpen(true);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

function AlertDialogContent({
  children,
  className,
  tone = "default",
}: {
  children: React.ReactNode;
  className?: string;
  tone?: "default" | "destructive";
}) {
  const { open, setOpen } = React.useContext(DialogContext);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const t = setTimeout(() => cancelRef.current?.focus(), 30);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <DialogContext.Provider value={{ open, setOpen, tone }}>
      <div
        className="rc-ad-overlay"
        data-state="open"
        onClick={() => setOpen(false)}
        aria-hidden="true"
      />
      <div
        className={cx(
          "rc-ad-content",
          tone === "destructive" && "rc-ad-content-destructive",
          className,
        )}
        data-state="open"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="rc-ad-title"
        aria-describedby="rc-ad-description"
      >
        <AlertDialogCancel ref={cancelRef} hidden />
        {children}
      </div>
    </DialogContext.Provider>
  );
}

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rc-ad-header", className)} {...props} />;
}

function AlertDialogTitle({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  const { tone } = React.useContext(DialogContext);
  return (
    <h2
      id="rc-ad-title"
      className={cx(
        "rc-ad-title",
        tone === "destructive" && "rc-ad-title-destructive",
        className,
      )}
    >
      {children}
    </h2>
  );
}

function AlertDialogDescription({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p id="rc-ad-description" className={cx("rc-ad-description", className)}>
      {children}
    </p>
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cx("rc-ad-footer", className)} {...props} />;
}

interface CancelProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  hidden?: boolean;
}
const AlertDialogCancel = React.forwardRef<HTMLButtonElement, CancelProps>(
  function AlertDialogCancel({ className, hidden, ...props }, ref) {
    const { setOpen } = React.useContext(DialogContext);
    if (hidden) {
      // Focus target only — the visible Cancel lives in the footer.
      return (
        <button
          ref={ref}
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}
          onClick={() => setOpen(false)}
        />
      );
    }
    return (
      <button
        ref={ref}
        type="button"
        className={cx("rc-btn rc-btn-ghost rc-ad-cancel", className)}
        onClick={(e) => {
          props.onClick?.(e);
          setOpen(false);
        }}
        {...props}
      />
    );
  },
);

function AlertDialogAction({
  className,
  children,
  disabled,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { tone, setOpen } = React.useContext(DialogContext);
  return (
    <button
      type="button"
      className={cx(
        "rc-btn",
        tone === "destructive" ? "rc-btn-danger" : "rc-btn-primary",
        className,
      )}
      disabled={disabled}
      onClick={(e) => {
        // The caller performs the async send; the dialog's job (confirm)
        // is done on click, so it closes and the wallet prompt takes over.
        props.onClick?.(e);
        setOpen(false);
      }}
      {...props}
    >
      {children}
    </button>
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
};

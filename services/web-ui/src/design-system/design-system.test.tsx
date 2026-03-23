import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";

import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";
import { Input } from "./Input";
import { Skeleton } from "./Skeleton";
import { ThemeToggle } from "./ThemeToggle";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applies primary variant class", () => {
    render(<Button variant="primary">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-[var(--color-ah-accent-muted)]");
  });

  it("applies destructive variant class", () => {
    render(<Button variant="destructive">Delete</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-[var(--color-ah-danger-muted)]");
  });

  it("passes disabled attribute", () => {
    render(<Button disabled>Nope</Button>);
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("fires onClick", () => {
    let clicked = false;
    render(<Button onClick={() => { clicked = true; }}>Press</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });
});

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Content here</Card>);
    expect(screen.getByText("Content here")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    const { container } = render(<Card className="extra">X</Card>);
    expect(container.firstChild).toHaveClass("extra");
  });
});

describe("Badge", () => {
  it("renders text", () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies success variant", () => {
    render(<Badge variant="success">Done</Badge>);
    expect(screen.getByText("Done")).toHaveClass("text-[var(--color-ah-success)]");
  });

  it("applies danger variant", () => {
    render(<Badge variant="danger">Error</Badge>);
    expect(screen.getByText("Error")).toHaveClass("text-[var(--color-ah-danger)]");
  });

  it("applies warning variant", () => {
    render(<Badge variant="warning">Warn</Badge>);
    expect(screen.getByText("Warn")).toHaveClass("text-[var(--color-ah-warning)]");
  });
});

describe("Input", () => {
  it("renders with label", () => {
    render(<Input label="Email" />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("renders without label", () => {
    render(<Input placeholder="Type..." />);
    expect(screen.getByPlaceholderText("Type...")).toBeInTheDocument();
  });

  it("passes input attributes", () => {
    render(<Input label="Name" type="text" required />);
    expect(screen.getByLabelText("Name")).toBeRequired();
  });
});

describe("Skeleton", () => {
  it("renders with aria-hidden", () => {
    const { container } = render(<Skeleton width="100px" height="20px" />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("applies inline styles", () => {
    const { container } = render(<Skeleton width="50%" height="2rem" />);
    const el = container.firstChild as HTMLElement;
    expect(el.style.width).toBe("50%");
    expect(el.style.height).toBe("2rem");
  });
});

describe("ThemeToggle", () => {
  beforeEach(() => {
    document.documentElement.classList.add("dark");
  });

  it("renders toggle button", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });

  it("toggles dark class on document", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
});

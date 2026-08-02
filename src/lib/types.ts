// Compat layer: thay thế convex/_generated/dataModel Id
// Trong Convex, Id là string; trong Postgres là number.
// Để tương thích với UI hiện tại (dùng string làm key), ta định nghĩa Id = string.
export type Id<T extends string = string> = string;

// Compat layer: thay thế convex/_generated/dataModel Doc<T>
// Doc<"notes">, Doc<"tasks">... là shape của document trong DB.
// Với Postgres ta không có typed Doc nên dùng record lỏng.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc<T extends string = string> = any;

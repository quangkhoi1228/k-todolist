import { SignInButton, Show } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import {
  LayoutGrid,
  BarChart3,
  Zap,
  CheckCircle2,
  ArrowRight,
  Layers,
  Timer,
  TrendingUp,
  Shield,
  Sparkles,
  KanbanSquare,
  GanttChart,
} from "lucide-react";

export default async function Home() {
  const { userId } = await auth();

  if (userId) {
    redirect("/board");
  }

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ====== NAVBAR ====== */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/60 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-[oklch(0.7_0.2_320)] flex items-center justify-center shadow-lg shadow-primary/20">
              <CheckCircle2 className="w-4.5 h-4.5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight">
              KFlow
            </span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
            <a
              href="#features"
              className="hover:text-foreground transition-colors"
            >
              Tính năng
            </a>
            <a
              href="#workflow"
              className="hover:text-foreground transition-colors"
            >
              Quy trình
            </a>
            <a
              href="#stats"
              className="hover:text-foreground transition-colors"
            >
              Hiệu suất
            </a>
          </div>

          <Show when="signed-out">
            <SignInButton mode="modal">
              <button className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:-translate-y-0.5 cursor-pointer">
                Bắt đầu ngay
              </button>
            </SignInButton>
          </Show>
        </div>
      </nav>

      {/* ====== HERO SECTION ====== */}
      <section className="relative pt-32 pb-20 md:pt-44 md:pb-32 px-6">
        {/* Decorative blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-primary/10 blur-[120px] animate-pulse" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-[oklch(0.6_0.2_320)]/10 blur-[120px] animate-pulse [animation-delay:2s]" />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full bg-[oklch(0.6_0.15_170)]/5 blur-[160px]" />
        </div>

        {/* Grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,oklch(0.5_0_0/0.03)_1px,transparent_1px),linear-gradient(to_bottom,oklch(0.5_0_0/0.03)_1px,transparent_1px)] bg-[size:4rem_4rem] pointer-events-none" />

        <div className="relative max-w-5xl mx-auto text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-semibold mb-8 backdrop-blur-sm">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Quản lý công việc thông minh thế hệ mới</span>
          </div>

          {/* Title */}
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight leading-[1.1] mb-6">
            <span className="block">Biến chaos thành</span>
            <span className="block bg-gradient-to-r from-primary via-[oklch(0.65_0.25_320)] to-[oklch(0.6_0.2_350)] bg-clip-text text-transparent">
              năng suất vượt trội
            </span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            Kanban board, Gantt chart, và auto-scheduling — tất cả trong một nền
            tảng duy nhất. Giúp bạn{" "}
            <span className="text-foreground font-medium">
              tập trung vào điều quan trọng
            </span>
            .
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="group px-8 py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 transition-all shadow-xl shadow-primary/25 hover:shadow-primary/40 hover:-translate-y-0.5 flex items-center gap-2 cursor-pointer">
                  Dùng thử miễn phí
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </button>
              </SignInButton>
            </Show>
            <a
              href="#features"
              className="px-8 py-3.5 rounded-xl border border-border text-foreground font-semibold text-base hover:bg-accent transition-all flex items-center gap-2"
            >
              Khám phá tính năng
            </a>
          </div>

          {/* Hero Preview — Kanban Mock */}
          <div className="relative max-w-4xl mx-auto">
            <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none" />
            <div className="glass-panel rounded-2xl p-6 border border-border/50">
              {/* Mock toolbar */}
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-border/50">
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-red-400/80" />
                  <div className="w-3 h-3 rounded-full bg-yellow-400/80" />
                  <div className="w-3 h-3 rounded-full bg-green-400/80" />
                </div>
                <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 max-w-xs">
                  <LayoutGrid className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">
                    KFlow — Kanban
                  </span>
                </div>
              </div>

              {/* Mock Kanban columns */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {[
                  {
                    title: "📋 Backlog",
                    color: "bg-muted/50",
                    tasks: [
                      {
                        name: "Thiết kế UI dashboard",
                        tag: "Design",
                        tagColor: "bg-[oklch(0.6_0.2_320)]/15 text-[oklch(0.6_0.2_320)]",
                      },
                      {
                        name: "Viết API endpoints",
                        tag: "Backend",
                        tagColor: "bg-[oklch(0.6_0.15_170)]/15 text-[oklch(0.6_0.15_170)]",
                      },
                    ],
                  },
                  {
                    title: "🔄 Đang làm",
                    color: "bg-primary/5",
                    tasks: [
                      {
                        name: "Tích hợp authentication",
                        tag: "Feature",
                        tagColor: "bg-primary/15 text-primary",
                      },
                      {
                        name: "Setup CI/CD pipeline",
                        tag: "DevOps",
                        tagColor: "bg-[oklch(0.7_0.15_80)]/15 text-[oklch(0.7_0.15_80)]",
                      },
                    ],
                  },
                  {
                    title: "👀 Review",
                    color: "bg-[oklch(0.7_0.15_80)]/5",
                    tasks: [
                      {
                        name: "Code review PR #42",
                        tag: "Review",
                        tagColor: "bg-[oklch(0.7_0.15_80)]/15 text-[oklch(0.7_0.15_80)]",
                      },
                    ],
                  },
                  {
                    title: "✅ Hoàn thành",
                    color: "bg-[oklch(0.6_0.15_170)]/5",
                    tasks: [
                      {
                        name: "Setup database schema",
                        tag: "Done",
                        tagColor: "bg-[oklch(0.6_0.15_170)]/15 text-[oklch(0.6_0.15_170)]",
                      },
                      {
                        name: "Landing page design",
                        tag: "Done",
                        tagColor: "bg-[oklch(0.6_0.15_170)]/15 text-[oklch(0.6_0.15_170)]",
                      },
                    ],
                  },
                ].map((col) => (
                  <div key={col.title} className="space-y-3">
                    <div
                      className={`px-3 py-2 rounded-lg ${col.color} flex items-center justify-between`}
                    >
                      <span className="text-xs font-bold">{col.title}</span>
                      <span className="text-[10px] font-semibold text-muted-foreground bg-background/60 px-1.5 py-0.5 rounded-md">
                        {col.tasks.length}
                      </span>
                    </div>
                    {col.tasks.map((task) => (
                      <div
                        key={task.name}
                        className="p-3 rounded-lg bg-card/80 border border-border/50 hover:border-primary/30 transition-colors group"
                      >
                        <p className="text-xs font-semibold mb-2 group-hover:text-primary transition-colors">
                          {task.name}
                        </p>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${task.tagColor}`}
                        >
                          {task.tag}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== FEATURES SECTION ====== */}
      <section id="features" className="relative py-24 px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-semibold mb-4">
              <Layers className="w-3.5 h-3.5" />
              Tính năng
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Tất cả công cụ bạn cần
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              Một bộ công cụ hoàn chỉnh để quản lý dự án từ ý tưởng đến hoàn
              thành.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              {
                icon: KanbanSquare,
                title: "Kanban Board",
                desc: "Kéo thả task giữa các cột, theo dõi tiến độ trực quan. Drag & drop mượt mà.",
                gradient: "from-primary/20 to-[oklch(0.65_0.25_320)]/20",
                iconColor: "text-primary",
              },
              {
                icon: GanttChart,
                title: "Gantt Chart",
                desc: "Timeline dự án rõ ràng, quản lý phụ thuộc giữa các task một cách dễ dàng.",
                gradient:
                  "from-[oklch(0.6_0.15_170)]/20 to-[oklch(0.65_0.2_200)]/20",
                iconColor: "text-[oklch(0.6_0.15_170)]",
              },
              {
                icon: Zap,
                title: "Auto Scheduling",
                desc: "AI tự động sắp xếp lịch trình tối ưu dựa trên deadline và workload.",
                gradient:
                  "from-[oklch(0.7_0.15_80)]/20 to-[oklch(0.65_0.2_60)]/20",
                iconColor: "text-[oklch(0.7_0.15_80)]",
              },
              {
                icon: Timer,
                title: "Capacity Warning",
                desc: "Cảnh báo khi workload vượt ngưỡng, giúp cân bằng công việc hiệu quả.",
                gradient:
                  "from-[oklch(0.6_0.2_25)]/20 to-[oklch(0.65_0.2_40)]/20",
                iconColor: "text-[oklch(0.65_0.2_30)]",
              },
              {
                icon: Layers,
                title: "Quản lý dự án",
                desc: "Phân loại task theo project, lọc và quản lý nhiều dự án đồng thời.",
                gradient:
                  "from-[oklch(0.65_0.25_320)]/20 to-[oklch(0.6_0.2_350)]/20",
                iconColor: "text-[oklch(0.65_0.25_320)]",
              },
              {
                icon: Shield,
                title: "Bảo mật cao",
                desc: "Xác thực qua Clerk, dữ liệu realtime trên Convex. An toàn tuyệt đối.",
                gradient: "from-primary/20 to-[oklch(0.5_0.2_260)]/20",
                iconColor: "text-primary",
              },
            ].map((feature) => (
              <div
                key={feature.title}
                className="group relative p-6 rounded-2xl border border-border/50 bg-card/40 backdrop-blur-sm hover:bg-card/60 hover:border-primary/20 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5"
              >
                <div
                  className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300`}
                />
                <div className="relative">
                  <div
                    className={`w-11 h-11 rounded-xl bg-muted/50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300 ${feature.iconColor}`}
                  >
                    <feature.icon className="w-5.5 h-5.5" />
                  </div>
                  <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {feature.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== WORKFLOW SECTION ====== */}
      <section id="workflow" className="relative py-24 px-6">
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/[0.02] to-transparent pointer-events-none" />

        <div className="max-w-5xl mx-auto relative">
          <div className="text-center mb-16">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/20 bg-primary/5 text-primary text-xs font-semibold mb-4">
              <BarChart3 className="w-3.5 h-3.5" />
              Quy trình
            </div>
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Đơn giản hóa mọi thứ
            </h2>
            <p className="text-muted-foreground text-lg max-w-xl mx-auto">
              3 bước để kiểm soát hoàn toàn workflow của bạn.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Tạo Task",
                desc: "Thêm task nhanh với tiêu đề, deadline, độ ưu tiên và dự án.",
                icon: "✍️",
              },
              {
                step: "02",
                title: "Theo dõi",
                desc: "Dùng Kanban hoặc Gantt chart để theo dõi tiến độ realtime.",
                icon: "📊",
              },
              {
                step: "03",
                title: "Hoàn thành",
                desc: "Drag & drop task vào Done. Phân tích hiệu suất và tối ưu.",
                icon: "🚀",
              },
            ].map((item, i) => (
              <div key={item.step} className="relative text-center group">
                {/* Connector line */}
                {i < 2 && (
                  <div className="hidden md:block absolute top-12 left-[60%] w-[80%] h-px bg-gradient-to-r from-primary/30 to-primary/5" />
                )}

                <div className="inline-flex items-center justify-center w-24 h-24 rounded-2xl bg-card/60 border border-border/50 mb-6 group-hover:scale-105 group-hover:border-primary/30 transition-all duration-300 shadow-lg shadow-black/5">
                  <span className="text-4xl">{item.icon}</span>
                </div>

                <div className="text-xs font-bold text-primary mb-2">
                  BƯỚC {item.step}
                </div>
                <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ====== STATS SECTION ====== */}
      <section id="stats" className="relative py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="glass-panel rounded-3xl p-10 md:p-16 text-center relative overflow-hidden">
            {/* Glow effects */}
            <div className="absolute -top-20 -right-20 w-60 h-60 rounded-full bg-primary/10 blur-[80px]" />
            <div className="absolute -bottom-20 -left-20 w-60 h-60 rounded-full bg-[oklch(0.6_0.2_320)]/10 blur-[80px]" />

            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-3">
                Được thiết kế cho hiệu suất
              </h2>
              <p className="text-muted-foreground mb-12 max-w-lg mx-auto">
                Những con số nói lên tất cả.
              </p>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
                {[
                  { value: "10x", label: "Năng suất tăng", icon: TrendingUp },
                  { value: "0.5s", label: "Realtime sync", icon: Zap },
                  { value: "∞", label: "Task không giới hạn", icon: Layers },
                  { value: "24/7", label: "Truy cập mọi lúc", icon: Shield },
                ].map((stat) => (
                  <div key={stat.label} className="group">
                    <stat.icon className="w-5 h-5 text-primary mx-auto mb-3 group-hover:scale-125 transition-transform duration-300" />
                    <div className="text-3xl md:text-4xl font-black text-foreground mb-1">
                      {stat.value}
                    </div>
                    <div className="text-xs text-muted-foreground font-medium">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====== CTA SECTION ====== */}
      <section className="relative py-24 px-6">
        <div className="max-w-3xl mx-auto text-center relative">
          <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-[oklch(0.65_0.25_320)]/5 to-primary/5 rounded-3xl blur-3xl" />

          <div className="relative">
            <h2 className="text-3xl md:text-5xl font-black tracking-tight mb-4">
              Sẵn sàng nâng cấp
              <br />
              <span className="bg-gradient-to-r from-primary to-[oklch(0.65_0.25_320)] bg-clip-text text-transparent">
                workflow của bạn?
              </span>
            </h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-lg mx-auto">
              Bắt đầu miễn phí, không cần thẻ tín dụng. Nâng cấp bất cứ lúc
              nào.
            </p>

            <Show when="signed-out">
              <SignInButton mode="modal">
                <button className="group px-10 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-lg hover:opacity-90 transition-all shadow-2xl shadow-primary/30 hover:shadow-primary/50 hover:-translate-y-1 flex items-center gap-3 mx-auto cursor-pointer">
                  Bắt đầu ngay — Miễn phí
                  <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </button>
              </SignInButton>
            </Show>
          </div>
        </div>
      </section>

      {/* ====== FOOTER ====== */}
      <footer className="border-t border-border/50 py-8 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-[oklch(0.7_0.2_320)] flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold">KFlow</span>
          </div>
          <p className="text-xs text-muted-foreground">
            © 2026 KFlow. Xây dựng với ❤️ bởi{" "}
            <span className="text-foreground font-medium">Khoi Tran</span>.
          </p>
        </div>
      </footer>
    </div>
  );
}

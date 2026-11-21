from manim import *


class UpdatersAndTrackers(Scene):
    def construct(self):
        ax = Axes(
            x_range=[0, 6], y_range=[0, 10, 2], x_length=8, y_length=5,
            axis_config={"include_numbers": True}, tips=False,
        )
        func = lambda x: 0.25 * x ** 2 + 1
        graph = ax.plot(func, color=BLUE)

        # a ValueTracker holds a number that animations can change
        t = ValueTracker(1)
        point = lambda: ax.c2p(t.get_value(), func(t.get_value()))

        # always_redraw rebuilds a mobject from scratch on every frame
        dot = always_redraw(lambda: Dot(point(), color=YELLOW))
        v_line = always_redraw(lambda: ax.get_vertical_line(point(), color=YELLOW))
        h_line = always_redraw(lambda: ax.get_horizontal_line(point(), color=YELLOW))

        # an updater changes an existing mobject instead: this number follows the dot
        value = DecimalNumber(func(t.get_value()), num_decimal_places=2, font_size=36)
        def follow(m):
            m.set_value(func(t.get_value()))
            m.next_to(dot, UL, buff=0.15)
        value.add_updater(follow)
        label = MathTex("f(x) = ", font_size=36).add_updater(lambda m: m.next_to(value, LEFT, buff=0.15))

        self.add(ax, graph, v_line, h_line, dot, value, label)
        self.play(t.animate.set_value(5), run_time=3)
        self.play(t.animate.set_value(2.5), run_time=2)
        self.wait()

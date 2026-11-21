from manim import *


class TransformMatching(Scene):
    def construct(self):
        # ReplacementTransform: the square becomes the circle (and is replaced by it)
        square = Square(color=BLUE, fill_opacity=0.5).shift(4 * LEFT + 1.5 * UP)
        circle = Circle(color=GREEN, fill_opacity=0.5).shift(1.5 * UP)
        self.play(Create(square))
        self.play(ReplacementTransform(square, circle))

        # TransformFromCopy: the circle stays, a copy of it becomes the star
        star = Star(color=YELLOW, fill_opacity=0.5).shift(4 * RIGHT + 1.5 * UP)
        self.play(TransformFromCopy(circle, star))

        # equations are made of outlines too, so they morph the same way
        pythagoras = MathTex("a^2", "+", "b^2", "=", "c^2")
        pythagoras.shift(1.5 * DOWN)
        self.play(Write(pythagoras))

        # TransformMatchingTex moves the parts that both formulas share
        swapped = MathTex("c^2", "=", "a^2", "+", "b^2")
        swapped.move_to(pythagoras)
        self.play(TransformMatchingTex(pythagoras, swapped, path_arc=PI / 2))

        solved = MathTex("c", "=", r"\sqrt{a^2 + b^2}")
        solved.move_to(swapped)
        self.play(ReplacementTransform(swapped, solved))
        self.wait(0.5)

        # copy one part of a formula somewhere else
        c_label = MathTex("c", color=YELLOW).next_to(star, DOWN)
        self.play(TransformFromCopy(solved[0], c_label))

        # FadeTransform cross-fades between mobjects that have nothing in common
        name = Text("Pythagoras", font_size=40).move_to(solved)
        self.play(FadeTransform(solved, name))
        self.wait()

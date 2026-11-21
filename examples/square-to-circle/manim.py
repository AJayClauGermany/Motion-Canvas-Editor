from manim import *


class SquareToCircle(Scene):
    def construct(self):
        circle = Circle()  # create a circle
        circle.set_fill(PINK, opacity=0.5)  # set its colour and transparency

        square = Square()  # create a square
        square.rotate(PI / 4)  # rotate it a quarter turn

        self.play(Create(square))  # draw the square
        self.play(Transform(square, circle))  # morph the square into the circle
        self.play(FadeOut(square))  # fade it out

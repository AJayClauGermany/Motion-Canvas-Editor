from manim import *


class TextAndColor(Scene):
    def construct(self):
        # t2c colours every occurrence of a substring
        title = Text("Text and colour", font_size=64, t2c={"Text": BLUE, "colour": YELLOW})
        title.to_edge(UP)
        self.play(Write(title))

        # every character is a submobject, so text slices like a list
        word = Text("Manim in Civet", font_size=56)
        word[0:5].set_color(RED)          # "Manim"
        word[5:7].set_color(GRAY)         # "in" (spaces are not submobjects)
        word[-5:].set_color(GREEN)        # "Civet"
        self.play(FadeIn(word, shift=UP))

        # colour letter by letter, or let the mobject spread a gradient
        line = Text("one letter at a time", font_size=40)
        for i in range(len(line)):
            line[i].set_color(interpolate_color(TEAL, PINK, i / (len(line) - 1)))
        line.next_to(word, DOWN, buff=0.6)
        self.play(AddTextLetterByLetter(line, time_per_char=0.05))

        gradient = Text("or a gradient across the whole line", font_size=40)
        gradient.set_color_by_gradient(BLUE, GREEN, YELLOW)
        gradient.next_to(line, DOWN, buff=0.4)
        self.play(Write(gradient))

        # slices animate like any other mobject
        self.play(word[0:5].animate.scale(1.3, about_edge=RIGHT).set_color(YELLOW), word[-5:].animate.set_color(ORANGE))
        self.play(Indicate(line[0:3]), Unwrite(gradient))
        self.wait()

LATEXMK ?= latexmk
PDFLATEX ?= pdflatex
TEX_FILES := $(shell find . -name '*.tex' ! -name 'preamble.tex' ! -name 'template.tex')
PDF_FILES := $(TEX_FILES:.tex=.pdf)

.PHONY: all clean watch list

all: $(PDF_FILES)

%.pdf: %.tex preamble.tex
	cd $(dir $<) && $(LATEXMK) -pdf -interaction=nonstopmode -halt-on-error $(notdir $<)

list:
	@echo "Spec files:"
	@$(foreach f,$(TEX_FILES),echo "  $(f)";)

clean:
	find . -type f \( -name '*.aux' -o -name '*.log' -o -name '*.out' -o -name '*.toc' -o -name '*.fls' -o -name '*.fdb_latexmk' -o -name '*.synctex.gz' \) -delete
	@echo "Cleaned auxiliary files."

cleanall: clean
	find . -name '*.pdf' ! -path './build/*' -delete
	@echo "Cleaned PDFs."

watch:
	$(LATEXMK) -pvc -pdf -interaction=nonstopmode

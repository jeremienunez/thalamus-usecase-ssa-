LATEXMK ?= latexmk
PDFLATEX ?= pdflatex
MMDC ?= ../../node_modules/.bin/mmdc

TEX_FILES := $(shell find . -name '*.tex' ! -name 'preamble.tex' ! -name 'preamble-arch.tex' ! -name 'template.tex')
PDF_FILES := $(TEX_FILES:.tex=.pdf)

MMD_FILES := $(shell find architecture/figures -name '*.mmd' 2>/dev/null)
FIG_PDF := $(MMD_FILES:.mmd=.pdf)

.PHONY: all clean cleanall watch list figures architecture

all: figures $(PDF_FILES)

figures: $(FIG_PDF)

architecture: figures $(filter architecture/%,$(PDF_FILES))

architecture/figures/%.pdf: architecture/figures/%.mmd
	$(MMDC) -i $< -o $@ -b transparent

architecture/%.pdf: architecture/%.tex architecture/preamble-arch.tex | figures
	cd $(dir $<) && $(LATEXMK) -pdf -interaction=nonstopmode -halt-on-error $(notdir $<)

%.pdf: %.tex preamble.tex
	cd $(dir $<) && $(LATEXMK) -pdf -interaction=nonstopmode -halt-on-error $(notdir $<)

list:
	@echo "Spec files:"
	@$(foreach f,$(TEX_FILES),echo "  $(f)";)
	@echo "Mermaid figures:"
	@$(foreach f,$(MMD_FILES),echo "  $(f)";)

clean:
	find . -type f \( -name '*.aux' -o -name '*.log' -o -name '*.out' -o -name '*.toc' -o -name '*.fls' -o -name '*.fdb_latexmk' -o -name '*.synctex.gz' \) -delete
	@echo "Cleaned auxiliary files."

cleanall: clean
	find . -name '*.pdf' ! -path './build/*' -delete
	@echo "Cleaned PDFs."

watch:
	$(LATEXMK) -pvc -pdf -interaction=nonstopmode

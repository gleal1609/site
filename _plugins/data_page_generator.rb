# Generates /projects/:slug/ from _data/projects.json

module Jekyll
  class DataPage < Page
    def initialize(site, base, dir, data)
      @site = site
      @base = base
      @dir = dir
      @name = 'index.html'

      self.process(@name)
      self.read_yaml(File.join(base, '_layouts'), 'project.html')
      self.data.merge!(data)
      self.data['title'] ||= data['title']
    end
  end

  class DataPageGenerator < Generator
    safe true
    priority :normal

    def generate(site)
      projects = site.data['projects']
      return unless projects.is_a?(Array)

      projects.each do |project|
        slug = project['slug']
        next unless slug

        page_data = {}
        project.each { |k, v| page_data[k] = v }

        site.pages << DataPage.new(
          site,
          site.source,
          File.join('projects', slug),
          page_data
        )
      end
    end
  end
end

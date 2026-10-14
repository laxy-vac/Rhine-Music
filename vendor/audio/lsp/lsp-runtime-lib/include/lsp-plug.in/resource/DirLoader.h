/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 окт. 2020 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_RESOURCE_DIRLOADER_H_
#define LSP_PLUG_IN_RESOURCE_DIRLOADER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/resource/ILoader.h>

namespace lsp
{
    namespace resource
    {
        class DirLoader: public ILoader
        {
            private:
                DirLoader & operator = (const DirLoader & );
                DirLoader(const DirLoader &);

            protected:
                io::Path        sPath;
                bool            bEnforce;

            protected:
                status_t        build_path(io::Path *dst, const io::Path *name);

            public:
                explicit DirLoader();
                virtual ~DirLoader();

            public:
                status_t        set_path(const char *path);
                status_t        set_path(const LSPString *path);
                status_t        set_path(const io::Path *path);

                bool            set_enforce(bool enforce);
                inline bool     get_enforce() const     { return bEnforce; }

            public:
                virtual io::IInStream      *read_stream(const io::Path *name);
                virtual ssize_t             enumerate(const io::Path *path, resource_t **list);
        };
    }
}

#endif /* LSP_PLUG_IN_RESOURCE_DIRLOADER_H_ */

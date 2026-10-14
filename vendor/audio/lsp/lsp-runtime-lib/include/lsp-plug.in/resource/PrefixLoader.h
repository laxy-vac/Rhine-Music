/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 8 июн. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_PREFIXLOADER_H_
#define LSP_PLUG_IN_RESOURCE_PREFIXLOADER_H_

#include <lsp-plug.in/resource/ILoader.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace resource
    {
        /**
         * This loader resolves resources according to the specified prefix
         * Multiple prefixes are possible
         */
        class PrefixLoader: public ILoader
        {
            private:
                ILoader & operator      = (const ILoader &);
                PrefixLoader(const PrefixLoader &);

            protected:
                typedef struct prefix_t
                {
                    LSPString       sPrefix;
                    ILoader        *pLoader;
                    bool            bFree;
                } prefix_t;

            protected:
                lltl::parray<prefix_t>      vLoaders;
                ILoader                    *pDefault;

            protected:
                static bool                 match_prefix(const LSPString *str, const LSPString *prefix);

            protected:
                ILoader                    *lookup_prefix(LSPString *dst, const LSPString *path);
                ILoader                    *lookup_prefix(LSPString *dst, const char *path);
                ILoader                    *lookup_prefix(LSPString *dst, const io::Path *path);

            public:
                explicit PrefixLoader(ILoader *dfl = NULL);
                virtual ~PrefixLoader();

            public:
                /**
                 * Associate some loader with prefix, loader will be automatically destroyed on destruction
                 * @param prefix prefix to use
                 * @param loader loader to associate
                 * @param free free after use
                 * @return status of operation
                 */
                status_t                    add_prefix(const char *prefix, ILoader *loader, bool free);
                status_t                    add_prefix(const LSPString *prefix, ILoader *loader, bool free);
                status_t                    add_prefix(const io::Path *prefix, ILoader *loader, bool free);

            public:
                virtual io::IInStream      *read_stream(const char *name);
                virtual io::IInStream      *read_stream(const LSPString *name);
                virtual io::IInStream      *read_stream(const io::Path *name);

                virtual io::IInSequence    *read_sequence(const char *name, const char *charset = NULL);
                virtual io::IInSequence    *read_sequence(const LSPString *name, const char *charset = NULL);
                virtual io::IInSequence    *read_sequence(const io::Path *name, const char *charset = NULL);

                virtual ssize_t             enumerate(const char *path, resource_t **list);
                virtual ssize_t             enumerate(const LSPString *path, resource_t **list);
                virtual ssize_t             enumerate(const io::Path *path, resource_t **list);
        };
    } /* namespace resource */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_RESOURCE_PREFIXLOADER_H_ */
